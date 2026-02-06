// ==UserScript==
// @name         极简自动点击录制器
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  录制点击，自动重复（支持手机触摸录制）
// @author       xyk
// @match        https://www.wanyiwan.top/*
// @grant        none
// @run-at       document-end
// @updateURL    https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-auto-click-recorder.user.js
// @downloadURL  https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-auto-click-recorder.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ========== 只在iframe内运行 ==========
    // 如果是父页面，不运行脚本
    if (window.location.href.indexOf('gameIframe') === -1) {
        return;
    }

    // ========== 配置 ==========
    const CONFIG = {
        clickDelay: 300,      // 点击间隔（毫秒）
        loopDelay: 2000,      // 每轮循环的延迟（毫秒）
        minDistance: 50,      // 最小距离（像素），小于此距离视为重复点击
    };

    // ========== 全局变量 ==========
    let canvas = null;
    let isRecording = false;
    let isPlaying = false;
    let recordedClicks = [];
    let isEditMode = false;
    let isShowingMarkers = false;
    let markersOverlay = null;
    // 触摸/点击去重：同一 tap 可能先 touchend 再 click，只记录一次
    let lastRecordedTime = 0;
    let lastRecordedClientX = -9999;
    let lastRecordedClientY = -9999;
    const RECORD_DEDUPE_MS = 400;
    const RECORD_DEDUPE_PX = 30;

    // ========== 工具函数 ==========
    /** 从鼠标或触摸事件中取 clientX/clientY（兼容桌面与手机） */
    function getEventClientXY(e) {
        if (e.touches && e.touches.length > 0) {
            return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
        }
        if (e.changedTouches && e.changedTouches.length > 0) {
            return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
        }
        return { clientX: e.clientX, clientY: e.clientY };
    }

    /** 复制到剪贴板（兼容无 clipboard API 的环境，如 iframe、手机、非 HTTPS） */
    function copyToClipboard(text) {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {}
        ta.remove();
        return Promise.resolve(ok);
    }

    /** 当 window.prompt 不可用时，用页面内弹窗让用户输入（返回 Promise<string|null>） */
    function getInputFromUser(message, defaultValue) {
        if (typeof window.prompt === 'function') {
            try {
                const v = window.prompt(message, defaultValue || '');
                return Promise.resolve(v != null ? v : null);
            } catch (e) {}
        }
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
            const box = document.createElement('div');
            box.style.cssText = 'background:#333;color:#fff;padding:20px;border-radius:8px;max-width:100%;width:400px;max-height:80vh;display:flex;flex-direction:column;';
            box.innerHTML = `<div style="margin-bottom:10px;font-size:14px;">${message.replace(/</g, '&lt;')}</div>`;
            const ta = document.createElement('textarea');
            ta.value = defaultValue || '';
            ta.placeholder = '请粘贴 JSON，或点下方「粘贴」从剪贴板读取';
            ta.style.cssText = 'width:100%;height:120px;resize:vertical;padding:8px;box-sizing:border-box;margin-bottom:12px;font-family:monospace;font-size:12px;-webkit-user-select:text;user-select:text;';
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
            const btnOk = document.createElement('button');
            btnOk.textContent = '确定';
            btnOk.style.cssText = 'padding:8px 16px;background:#009688;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:36px;';
            const btnCancel = document.createElement('button');
            btnCancel.textContent = '取消';
            btnCancel.style.cssText = 'padding:8px 16px;background:#555;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:36px;';
            const btnPaste = document.createElement('button');
            btnPaste.textContent = '从剪贴板粘贴';
            btnPaste.style.cssText = 'padding:8px 16px;background:#607D8B;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:36px;';
            btnPaste.onclick = async () => {
                if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                    try {
                        const t = await navigator.clipboard.readText();
                        if (t) ta.value = ta.value ? ta.value + '\n' + t : t;
                    } catch (e) {}
                }
            };
            function close(result) {
                overlay.remove();
                resolve(result);
            }
            btnOk.onclick = () => close(ta.value.trim() || null);
            btnCancel.onclick = () => close(null);
            row.appendChild(btnCancel);
            row.appendChild(btnPaste);
            row.appendChild(btnOk);
            box.appendChild(ta);
            box.appendChild(row);
            overlay.appendChild(box);
            overlay.onclick = (e) => { if (e.target === overlay) close(null); };
            document.body.appendChild(overlay);
            ta.focus();
        });
    }

    /** 当 window.prompt 不可用时，用页面内弹窗显示文本供用户复制 */
    function showTextForCopy(title, text) {
        if (typeof window.prompt === 'function') {
            try {
                window.prompt(title, text);
                return;
            } catch (e) {}
        }
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#333;color:#fff;padding:20px;border-radius:8px;max-width:100%;width:400px;max-height:80vh;display:flex;flex-direction:column;';
        box.innerHTML = `<div style="margin-bottom:10px;font-size:14px;">${title.replace(/</g, '&lt;')}</div>`;
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.readOnly = true;
        ta.style.cssText = 'width:100%;height:200px;resize:vertical;padding:8px;box-sizing:border-box;margin-bottom:12px;font-family:monospace;font-size:12px;-webkit-user-select:text;user-select:text;';
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
        const btnCopy = document.createElement('button');
        btnCopy.textContent = '再试一次复制';
        btnCopy.style.cssText = 'padding:8px 16px;background:#607D8B;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:36px;';
        btnCopy.onclick = async () => {
            const ok = await copyToClipboard(ta.value);
            if (ok) btnCopy.textContent = '已复制';
        };
        const btn = document.createElement('button');
        btn.textContent = '关闭';
        btn.style.cssText = 'padding:8px 16px;background:#009688;color:#fff;border:none;border-radius:4px;cursor:pointer;min-height:36px;';
        btn.onclick = () => overlay.remove();
        btnRow.appendChild(btnCopy);
        btnRow.appendChild(btn);
        box.appendChild(ta);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
        ta.select();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function findCanvas() {
        const canvases = document.getElementsByTagName('canvas');
        if (canvases.length === 0) return null;

        let largest = null;
        let maxArea = 0;

        for (let c of canvases) {
            const area = c.width * c.height;
            // 只选择尺寸大于100的Canvas（过滤掉0x0的）
            if (area > 100 && area > maxArea) {
                maxArea = area;
                largest = c;
            }
        }

        return largest;
    }

    // ========== 点击功能 ==========
    async function clickAt(x, y) {
        if (!canvas) {
            console.warn('Canvas未找到，无法点击');
            updateStatus('错误：Canvas未找到');
            return false;
        }

        console.warn(`准备点击Canvas坐标: (${x.toFixed(0)}, ${y.toFixed(0)})`);

        const rect = canvas.getBoundingClientRect();
        const clientX = rect.left + x;
        const clientY = rect.top + y;

        console.warn(`Canvas位置: left=${rect.left}, top=${rect.top}`);
        console.warn(`页面坐标: (${clientX.toFixed(0)}, ${clientY.toFixed(0)})`);

        // 简化：只派发最基本的3个事件
        try {
            // 方法1: 尝试document.createEvent (兼容性更好)
            let evt;

            // mousedown
            evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('mousedown', true, true, window, 0,
                window.screenX + clientX, window.screenY + clientY,
                clientX, clientY, false, false, false, false, 0, null);
            canvas.dispatchEvent(evt);
            await sleep(50);

            // mouseup
            evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('mouseup', true, true, window, 0,
                window.screenX + clientX, window.screenY + clientY,
                clientX, clientY, false, false, false, false, 0, null);
            canvas.dispatchEvent(evt);
            await sleep(50);

            // click
            evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 0,
                window.screenX + clientX, window.screenY + clientY,
                clientX, clientY, false, false, false, false, 0, null);
            canvas.dispatchEvent(evt);

            console.warn('✓ 点击事件派发成功');
        } catch (error) {
            console.warn('派发事件失败:', error);
            // 尝试最简单的方式
            canvas.click();
        }

        console.warn(`点击完成，等待${CONFIG.clickDelay}ms`);
        await sleep(CONFIG.clickDelay);
        return true;
    }

    // ========== 本地存储 ==========
    function saveToLocal() {
        try {
            localStorage.setItem('autoClickRecording', JSON.stringify(recordedClicks));
            console.warn('✓ 录制已自动保存到本地');

            // 显示保存指示器
            const indicator = document.getElementById('save-indicator');
            if (indicator) {
                indicator.style.display = 'inline';
            }
        } catch (e) {
            console.warn('保存失败:', e);
        }
    }

    function loadFromLocal() {
        try {
            const saved = localStorage.getItem('autoClickRecording');
            if (saved) {
                recordedClicks = JSON.parse(saved);
                console.warn(`✓ 加载了之前的录制: ${recordedClicks.length}个点击`);
                return true;
            }
        } catch (e) {
            console.warn('加载失败:', e);
        }
        return false;
    }

    function clearLocal() {
        localStorage.removeItem('autoClickRecording');
        console.warn('✓ 已清除本地存储');
    }

    // ========== 录制功能 ==========
    function startRecord(append = false) {
        if (!append) {
            recordedClicks = [];

            // 新录制时，清空标记并准备实时显示
            hideMarkers();
        } else {
            console.warn(`补充录制模式，当前已有 ${recordedClicks.length} 个点击`);
        }

        // 录制时开启实时显示模式
        isShowingMarkers = true;
        document.getElementById('show-markers').style.background = '#009688';
        document.getElementById('show-markers').textContent = '👁️ 隐藏';

        isRecording = true;
        updateStatus(append ? `补充录制中...` : `录制中...`);
        canvas.addEventListener('click', recordHandler);
        canvas.addEventListener('touchend', recordHandlerTouch, { passive: true });

        // 隐藏保存指示器（新的录制）
        if (!append) {
            const indicator = document.getElementById('save-indicator');
            if (indicator) indicator.style.display = 'none';
        }
    }

    function stopRecord() {
        isRecording = false;
        canvas.removeEventListener('click', recordHandler);
        canvas.removeEventListener('touchend', recordHandlerTouch, { passive: true });
        updateStatus(`录制完成: ${recordedClicks.length}个点击`);
        console.warn('录制的点击:', recordedClicks);

        // 自动保存到本地存储
        saveToLocal();

        // 录制完成后自动显示点位
        if (!isShowingMarkers && recordedClicks.length > 0) {
            isShowingMarkers = true;
            document.getElementById('show-markers').style.background = '#009688';
            document.getElementById('show-markers').textContent = '👁️ 隐藏';
        }

        // 刷新显示
        if (isShowingMarkers) {
            showMarkers(false);
        }
    }

    /** 从 client 坐标录制一个点（供 click / touchend 共用，含去重） */
    function recordClickAt(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        // 同一 tap 可能先 touchend 再 click，短时间内同位置只记一次
        const now = Date.now();
        const distFromLast = Math.sqrt(Math.pow(clientX - lastRecordedClientX, 2) + Math.pow(clientY - lastRecordedClientY, 2));
        if (now - lastRecordedTime < RECORD_DEDUPE_MS && distFromLast < RECORD_DEDUPE_PX) {
            return;
        }
        lastRecordedTime = now;
        lastRecordedClientX = clientX;
        lastRecordedClientY = clientY;

        // 检查是否和所有已录制的点太接近（去重）
        for (let i = 0; i < recordedClicks.length; i++) {
            const existingClick = recordedClicks[i];
            const existingX = (existingClick.x / 100) * canvas.width;
            const existingY = (existingClick.y / 100) * canvas.height;

            const distance = Math.sqrt(Math.pow(x - existingX, 2) + Math.pow(y - existingY, 2));

            if (distance < CONFIG.minDistance) {
                console.warn(`点击位置太接近第 ${i + 1} 个点 (距离${distance.toFixed(0)}px)，已忽略`);
                updateStatus(`已忽略重复点击 (与#${i + 1}距离${distance.toFixed(0)}px)`);

                // 显示灰色标记表示被忽略
                showIgnoredMarker(x, y);
                return;
            }
        }

        // 使用百分比（适应不同分辨率）
        const xPercent = (x / canvas.width) * 100;
        const yPercent = (y / canvas.height) * 100;

        recordedClicks.push({ x: xPercent, y: yPercent });

        // 更新UI显示
        document.getElementById('click-count').textContent = recordedClicks.length;
        updateStatus(`已录制: ${recordedClicks.length}个点击`);
        console.warn(`✓ 录制点击 #${recordedClicks.length}: (${xPercent.toFixed(2)}%, ${yPercent.toFixed(2)}%)`);

        // 显示点击标记
        showClickMarker(x, y);

        // 如果正在显示点位模式，实时更新显示
        if (isShowingMarkers) {
            showMarkers(false);
        }
    }

    function recordHandler(e) {
        const { clientX, clientY } = getEventClientXY(e);
        recordClickAt(clientX, clientY);
    }

    /** 手机触摸结束时录制（触摸屏上 click 可能不触发或延迟） */
    function recordHandlerTouch(e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const { clientX, clientY } = getEventClientXY(e);
        recordClickAt(clientX, clientY);
    }

    function showClickMarker(x, y) {
        const marker = document.createElement('div');
        marker.style.cssText = `
            position: fixed;
            left: ${canvas.getBoundingClientRect().left + x - 10}px;
            top: ${canvas.getBoundingClientRect().top + y - 10}px;
            width: 20px;
            height: 20px;
            border: 3px solid red;
            border-radius: 50%;
            pointer-events: none;
            z-index: 99998;
        `;
        document.body.appendChild(marker);
        setTimeout(() => marker.remove(), 500);
    }

    function showIgnoredMarker(x, y) {
        const marker = document.createElement('div');
        marker.style.cssText = `
            position: fixed;
            left: ${canvas.getBoundingClientRect().left + x - 8}px;
            top: ${canvas.getBoundingClientRect().top + y - 8}px;
            width: 16px;
            height: 16px;
            border: 2px solid gray;
            border-radius: 50%;
            pointer-events: none;
            z-index: 99998;
            background: rgba(128, 128, 128, 0.3);
        `;
        document.body.appendChild(marker);
        setTimeout(() => marker.remove(), 800);
    }

    // ========== 回放功能 ==========
    async function playOnce() {
        if (recordedClicks.length === 0) {
            alert('还没有录制任何点击！');
            return;
        }

        if (!canvas) {
            alert('Canvas未找到！请等待游戏加载。');
            return;
        }

        // 回放时只退出编辑模式，保留显示模式
        if (isEditMode) {
            toggleEditMode();
        }

        console.warn(`开始回放 ${recordedClicks.length} 个点击`);

        for (let i = 0; i < recordedClicks.length; i++) {
            if (!isPlaying) {
                console.warn('回放被停止');
                break;
            }

            const click = recordedClicks[i];
            const x = (click.x / 100) * canvas.width;
            const y = (click.y / 100) * canvas.height;

            console.warn(`回放 ${i + 1}/${recordedClicks.length}: (${x.toFixed(0)}, ${y.toFixed(0)})`);
            updateStatus(`回放中: ${i + 1}/${recordedClicks.length}`);

            const success = await clickAt(x, y);
            if (!success) {
                console.warn('点击失败，停止回放');
                break;
            }
        }

        console.warn('回放完成');
    }

    async function playLoop() {
        if (recordedClicks.length === 0) {
            alert('还没有录制任何点击！');
            return;
        }

        if (!canvas) {
            alert('Canvas未找到！请等待游戏加载。');
            return;
        }

        isPlaying = true;
        let round = 1;

        console.warn('开始循环回放');

        while (isPlaying) {
            console.warn(`===== 第 ${round} 轮 =====`);
            updateStatus(`循环第 ${round} 轮...`);
            await playOnce();
            round++;
            await sleep(CONFIG.loopDelay);
        }

        console.warn('循环回放已停止');
    }

    function stopPlay() {
        isPlaying = false;
        updateStatus('已停止');
    }

    // ========== 编辑模式 ==========
    function toggleShowMarkers() {
        isShowingMarkers = !isShowingMarkers;

        if (isShowingMarkers) {
            if (recordedClicks.length === 0) {
                updateStatus('没有录制数据');
                isShowingMarkers = false;
                return;
            }
            showMarkers(false); // false = 只显示，不可删除
            updateStatus('显示点位中');
            document.getElementById('show-markers').style.background = '#009688';
            document.getElementById('show-markers').textContent = '👁️ 隐藏';
            console.warn('显示点位');
        } else {
            hideMarkers();
            updateStatus('就绪');
            document.getElementById('show-markers').style.background = '#00BCD4';
            document.getElementById('show-markers').textContent = '👁️ 显示';
            console.warn('隐藏点位');
        }
    }

    function toggleEditMode() {
        isEditMode = !isEditMode;

        if (isEditMode) {
            if (recordedClicks.length === 0) {
                updateStatus('没有录制数据');
                isEditMode = false;
                return;
            }

            // 如果正在显示，先隐藏
            if (isShowingMarkers) {
                isShowingMarkers = false;
                document.getElementById('show-markers').style.background = '#00BCD4';
                document.getElementById('show-markers').textContent = '👁️ 显示';
            }

            showMarkers(true); // true = 可编辑删除
            updateStatus('点击红点可删除');
            document.getElementById('edit-mode').style.background = '#E91E63';
            document.getElementById('edit-mode').textContent = '✖️ 退出';
            console.warn('进入编辑模式');
        } else {
            // 退出编辑模式后，自动恢复显示模式
            hideMarkers();
            if (recordedClicks.length > 0) {
                isShowingMarkers = true;
                document.getElementById('show-markers').style.background = '#009688';
                document.getElementById('show-markers').textContent = '👁️ 隐藏';
                showMarkers(false);
                updateStatus('显示点位中');
            } else {
                updateStatus('就绪');
            }
            document.getElementById('edit-mode').style.background = '#9C27B0';
            document.getElementById('edit-mode').textContent = '✏️ 编辑';
            console.warn('退出编辑模式');
        }
    }

    function showMarkers(editable = false) {
        if (!canvas) return;

        // 创建覆盖层
        if (markersOverlay) {
            markersOverlay.remove();
        }

        const rect = canvas.getBoundingClientRect();
        markersOverlay = document.createElement('div');
        markersOverlay.id = 'markers-overlay';
        markersOverlay.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            top: ${rect.top}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            pointer-events: none;
            z-index: 99998;
        `;

        // 为每个点击创建标记
        recordedClicks.forEach((click, index) => {
            const x = (click.x / 100) * canvas.width;
            const y = (click.y / 100) * canvas.height;

            const marker = document.createElement('div');
            marker.className = 'click-marker';
            marker.dataset.index = index;
            marker.style.cssText = `
                position: absolute;
                left: ${x}px;
                top: ${y}px;
                width: 30px;
                height: 30px;
                margin-left: -15px;
                margin-top: -15px;
                background: ${editable ? 'rgba(255, 0, 0, 0.7)' : 'rgba(0, 188, 212, 0.7)'};
                border: 3px solid white;
                border-radius: 50%;
                cursor: ${editable ? 'pointer' : 'default'};
                pointer-events: ${editable ? 'auto' : 'none'};
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 12px;
                font-weight: bold;
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
            `;
            marker.textContent = index + 1;

            // 只有编辑模式才可以点击删除
            if (editable) {
                marker.onclick = (e) => {
                    e.stopPropagation();
                    deleteClick(index);
                };
            }

            markersOverlay.appendChild(marker);
        });

        document.body.appendChild(markersOverlay);
        console.warn(`显示了 ${recordedClicks.length} 个标记 (${editable ? '可编辑' : '只读'})`);
    }

    function hideMarkers() {
        if (markersOverlay) {
            markersOverlay.remove();
            markersOverlay = null;
        }
    }

    function deleteClick(index) {
        console.warn(`删除第 ${index + 1} 个点击`);
        recordedClicks.splice(index, 1);

        // 更新显示
        document.getElementById('click-count').textContent = recordedClicks.length;

        // 保存到本地
        saveToLocal();

        // 刷新标记（保持当前模式）
        if (isEditMode) {
            showMarkers(true);
        } else if (isShowingMarkers) {
            showMarkers(false);
        }

        updateStatus(`已删除，剩余 ${recordedClicks.length} 个`);

        if (recordedClicks.length === 0) {
            toggleEditMode(); // 自动退出编辑模式
            document.getElementById('save-indicator').style.display = 'none';
        }
    }

    // ========== 控制面板 ==========
    function createPanel() {
        // 先清除已存在的面板
        const existing = document.getElementById('control-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'control-panel';
        panel.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 0;
            border-radius: 8px;
            z-index: 99999;
            font-family: Arial;
            width: 290px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            font-size: 17px;
        `;

        panel.innerHTML = `
            <div id="panel-header" style="padding: 14px 18px; background: rgba(255,255,255,0.1); border-radius: 8px 8px 0 0; cursor: move; font-weight: bold; display: flex; justify-content: space-between; align-items: center; font-size: 16px;">
                <span>🎮 自动点击</span>
                <button id="hide-btn" style="background: none; border: none; color: white; cursor: pointer; font-size: 20px; padding: 0;">✖️</button>
            </div>
            <div id="panel-content" style="padding: 18px;">
                <div style="margin-bottom: 14px; font-size: 14px; color: #aaa; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span id="click-count">0</span>次
                        <span id="save-indicator" style="color: #4CAF50; display: none;">💾</span>
                    </div>
                    <button id="toggle-list" style="background: none; border: 1px solid #555; color: #aaa; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">
                        查看
                    </button>
                </div>

                <div id="click-list" style="display: none; max-height: 200px; overflow-y: auto; background: rgba(255,255,255,0.05); border-radius: 4px; padding: 8px; margin-bottom: 10px; font-size: 11px;">
                    <div id="click-list-content" style="color: #999;">暂无录制</div>
                </div>

                <div style="display: flex; gap: 5px; margin: 6px 0;">
                    <button id="start-record" style="flex: 1; padding: 12px; background: #f44336; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;">
                        📹 新录制
                    </button>
                    <button id="append-record" style="flex: 1; padding: 12px; background: #FF5722; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">
                        ➕ 补充
                    </button>
                </div>

                <button id="stop-record" style="width: 100%; padding: 12px; margin: 6px 0; background: #795548; color: white; border: none; border-radius: 5px; cursor: pointer; display: none; font-size: 15px; font-weight: bold;">
                    ⏹️ 停止录制
                </button>

                <button id="play-once" style="width: 100%; padding: 12px; margin: 6px 0; background: #2196F3; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 15px;">
                    ▶️ 回放
                </button>

                <button id="play-loop" style="width: 100%; padding: 12px; margin: 6px 0; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 15px; font-weight: bold;">
                    🔄 循环
                </button>

                <button id="stop-play" style="width: 100%; padding: 12px; margin: 6px 0; background: #FF9800; color: white; border: none; border-radius: 5px; cursor: pointer; display: none; font-size: 15px;">
                    ⏸️ 停止
                </button>

                <div style="display: flex; gap: 5px; margin: 6px 0;">
                    <button id="show-markers" style="flex: 1; padding: 12px; background: #00BCD4; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 13px;">
                        👁️ 显示
                    </button>
                    <button id="edit-mode" style="flex: 1; padding: 12px; background: #9C27B0; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 13px;">
                        ✏️ 编辑
                    </button>
                </div>

                <button id="clear-record" style="width: 100%; padding: 12px; margin: 6px 0; background: #607D8B; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">
                    🗑️ 清除
                </button>

                <div style="display: flex; gap: 5px; margin: 6px 0;">
                    <button id="export-fixed-points" style="flex: 1; padding: 10px; background: #009688; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 13px;">
                        📤 导出
                    </button>
                    <button id="import-fixed-points" style="flex: 1; padding: 10px; background: #00897B; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 13px;">
                        📥 导入
                    </button>
                </div>

                <div id="status" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #555; font-size: 13px; color: #aaa;">
                    就绪
                </div>

                <div style="margin-top: 8px; font-size: 10px; color: #666; text-align: center;">
                    自动去重：${CONFIG.minDistance}px
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        bindEvents();
        makeDraggable(panel);
    }

    function bindEvents() {
        // 录制按钮
        document.getElementById('start-record').onclick = () => {
            startRecord(false); // 新录制
            document.getElementById('start-record').parentElement.style.display = 'none';
            document.getElementById('stop-record').style.display = 'block';
        };

        // 补充录制按钮
        document.getElementById('append-record').onclick = () => {
            if (recordedClicks.length === 0) {
                updateStatus('没有数据，请先新录制');
                setTimeout(() => updateStatus('就绪'), 2000);
                return;
            }
            startRecord(true); // 补充录制
            document.getElementById('start-record').parentElement.style.display = 'none';
            document.getElementById('stop-record').style.display = 'block';
        };

        document.getElementById('stop-record').onclick = () => {
            stopRecord();
            document.getElementById('start-record').parentElement.style.display = 'flex';
            document.getElementById('stop-record').style.display = 'none';
            document.getElementById('click-count').textContent = recordedClicks.length;
        };

        // 回放按钮
        document.getElementById('play-once').onclick = async () => {
            isPlaying = true;
            await playOnce();
            isPlaying = false;

            // 回放完成后，如果有录制数据，确保显示点位
            if (recordedClicks.length > 0 && !isShowingMarkers) {
                isShowingMarkers = true;
                document.getElementById('show-markers').style.background = '#009688';
                document.getElementById('show-markers').textContent = '👁️ 隐藏';
                showMarkers(false);
            }

            updateStatus(isShowingMarkers ? '显示点位中' : '回放完成');
        };

        document.getElementById('play-loop').onclick = () => {
            document.getElementById('play-loop').style.display = 'none';
            document.getElementById('play-once').style.display = 'none';
            document.getElementById('stop-play').style.display = 'block';
            playLoop();
        };

        document.getElementById('stop-play').onclick = () => {
            stopPlay();
            document.getElementById('play-loop').style.display = 'block';
            document.getElementById('play-once').style.display = 'block';
            document.getElementById('stop-play').style.display = 'none';
        };

        // 显示点位按钮
        document.getElementById('show-markers').onclick = () => {
            toggleShowMarkers();
        };

        // 编辑模式按钮
        document.getElementById('edit-mode').onclick = () => {
            toggleEditMode();
        };

        // 清除按钮 - 双击清除（防止误操作）
        let clearClickCount = 0;
        let clearClickTimer = null;

        document.getElementById('clear-record').onclick = () => {
            console.warn('点击了清除按钮');
            const count = recordedClicks.length;

            if (count === 0) {
                updateStatus('没有数据需要清除');
                return;
            }

            clearClickCount++;

            if (clearClickCount === 1) {
                updateStatus('再次点击清除确认');
                console.warn('第一次点击，等待确认');

                // 3秒内不再点击则重置
                clearClickTimer = setTimeout(() => {
                    clearClickCount = 0;
                    updateStatus('已取消清除');
                }, 3000);
            } else if (clearClickCount === 2) {
                // 确认清除
                clearTimeout(clearClickTimer);
                clearClickCount = 0;

                recordedClicks = [];
                clearLocal();
                document.getElementById('click-count').textContent = '0';
                document.getElementById('save-indicator').style.display = 'none';

                // 清除后隐藏标记并更新按钮状态
                if (isShowingMarkers) {
                    hideMarkers();
                    isShowingMarkers = false;
                    document.getElementById('show-markers').style.background = '#00BCD4';
                    document.getElementById('show-markers').textContent = '👁️ 显示';
                }

                updateStatus('✓ 已清除');
                console.warn(`已清除 ${count} 个点击的录制数据`);
            }
        };

        // 导出固定点位（百分比坐标，供「固定点位循环点击器」使用）
        document.getElementById('export-fixed-points').onclick = async () => {
            if (recordedClicks.length === 0) {
                updateStatus('没有录制数据可导出');
                return;
            }
            const json = JSON.stringify(recordedClicks);
            const ok = await copyToClipboard(json);
            if (ok) {
                updateStatus('已复制到剪贴板，可在「固定点位循环点击器」中粘贴导入');
                console.warn('导出固定点位:', recordedClicks.length, '个');
            } else {
                updateStatus('复制失败，请手动复制。内容已弹窗显示');
                showTextForCopy('请手动复制以下内容（Ctrl+C）：', json);
            }
        };

        // 导入固定点位（从剪贴板或粘贴的 JSON）
        document.getElementById('import-fixed-points').onclick = async () => {
            let text = '';
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                try {
                    text = await navigator.clipboard.readText();
                } catch (e) {}
            }
            if (!text || !text.trim()) {
                text = await getInputFromUser('请粘贴导出的固定点位 JSON（与导出格式一致）：', '');
            }
            if (!text || !text.trim()) {
                updateStatus('已取消导入');
                return;
            }
            let arr;
            try {
                arr = JSON.parse(text.trim());
            } catch (e) {
                updateStatus('导入失败：JSON 格式错误');
                return;
            }
            if (!Array.isArray(arr)) {
                updateStatus('导入失败：需要是数组格式');
                return;
            }
            const valid = arr.filter(item => item && typeof item.x === 'number' && typeof item.y === 'number');
            if (valid.length === 0) {
                updateStatus('导入失败：未找到有效的 {x, y} 点位');
                return;
            }
            if (valid.length < arr.length) {
                console.warn('导入时忽略了', arr.length - valid.length, '个无效项');
            }
            recordedClicks = valid;
            document.getElementById('click-count').textContent = recordedClicks.length;
            saveToLocal();
            document.getElementById('save-indicator').style.display = 'inline';
            isShowingMarkers = true;
            document.getElementById('show-markers').style.background = '#009688';
            document.getElementById('show-markers').textContent = '👁️ 隐藏';
            if (canvas) showMarkers(false);
            updateStatus(`已导入 ${recordedClicks.length} 个点位`);
            console.warn('导入固定点位:', recordedClicks.length, '个');
        };

        // 隐藏按钮
        document.getElementById('hide-btn').onclick = () => {
            document.getElementById('control-panel').style.display = 'none';
            createShowButton();
        };
    }

    function updateStatus(text) {
        const status = document.getElementById('status');
        if (status) status.textContent = text;
    }

    function makeDraggable(panel) {
        const header = document.getElementById('panel-header');
        let isDragging = false;
        let startX, startY;

        function startDrag(clientX, clientY) {
            if (isDragging) return;
            isDragging = true;
            startX = clientX - panel.offsetLeft;
            startY = clientY - panel.offsetTop;
        }
        function moveDrag(clientX, clientY) {
            if (!isDragging) return;
            const x = Math.max(0, Math.min(clientX - startX, window.innerWidth - panel.offsetWidth));
            const y = Math.max(0, Math.min(clientY - startY, window.innerHeight - panel.offsetHeight));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
            panel.style.right = 'auto';
        }
        function endDrag() {
            isDragging = false;
        }

        header.onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            startDrag(e.clientX, e.clientY);
        };
        document.onmousemove = (e) => moveDrag(e.clientX, e.clientY);
        document.onmouseup = () => endDrag();

        // 手机触摸拖拽
        header.addEventListener('touchstart', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            const { clientX, clientY } = getEventClientXY(e);
            startDrag(clientX, clientY);
        }, { passive: false });
        document.addEventListener('touchmove', (e) => {
            if (!isDragging || !e.touches.length) return;
            const { clientX, clientY } = getEventClientXY(e);
            moveDrag(clientX, clientY);
        }, { passive: true });
        document.addEventListener('touchend', () => endDrag(), { passive: true });
    }

    function createShowButton() {
        // 先清除已存在的按钮
        const existing = document.getElementById('show-btn');
        if (existing) existing.remove();

        const btn = document.createElement('button');
        btn.id = 'show-btn';
        btn.textContent = '🎮';
        btn.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            width: 55px;
            height: 55px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            z-index: 99999;
            font-size: 26px;
        `;

        btn.onclick = () => {
            document.getElementById('control-panel').style.display = 'block';
            btn.remove();
        };

        document.body.appendChild(btn);
    }

    // ========== 初始化 ==========
    function init() {
        console.warn('✓ 极简自动点击脚本已启动');

        // 立即创建面板
        createPanel();

        // 加载之前保存的录制
        const hasLoaded = loadFromLocal();
        if (hasLoaded) {
            document.getElementById('click-count').textContent = recordedClicks.length;
            document.getElementById('save-indicator').style.display = 'inline';
            console.warn('💾 检测到之前的录制，已自动加载！');

            // 自动显示点位标记
            isShowingMarkers = true;
            document.getElementById('show-markers').style.background = '#009688';
            document.getElementById('show-markers').textContent = '👁️ 隐藏';
        }

        // 查找Canvas
        canvas = findCanvas();

        if (!canvas) {
            console.warn('未找到Canvas，等待游戏加载...');
            updateStatus('等待Canvas加载...');
            // 持续检查Canvas
            const retry = setInterval(() => {
                canvas = findCanvas();
                if (canvas) {
                    console.warn('✓ 找到Canvas: ' + canvas.width + ' x ' + canvas.height);
                    if (hasLoaded) {
                        updateStatus(`已加载: ${recordedClicks.length}个点击`);
                        // Canvas加载后，如果已经设置为显示模式，则显示标记
                        if (isShowingMarkers) {
                            showMarkers(false);
                        }
                    } else {
                        updateStatus('就绪');
                    }
                    clearInterval(retry);
                }
            }, 500);
        } else {
            console.warn('✓ 找到Canvas: ' + canvas.width + ' x ' + canvas.height);
            if (hasLoaded) {
                updateStatus(`已加载: ${recordedClicks.length}个点击`);
                // Canvas已存在，如果已经设置为显示模式，则显示标记
                if (isShowingMarkers) {
                    showMarkers(false);
                }
            } else {
                updateStatus('就绪');
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
