// ==UserScript==
// @name         极简自动点击录制器
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  录制点击，自动重复
// @author       xyk
// @match        https://www.wanyiwan.top/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/xieyankun123/tampermonkey/master/scripts/xjjd-auto-click-recorder.user.js
// @downloadURL  https://raw.githubusercontent.com/xieyankun123/tampermonkey/master/scripts/xjjd-auto-click-recorder.user.js
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

    // ========== 工具函数 ==========
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

        // 隐藏保存指示器（新的录制）
        if (!append) {
            const indicator = document.getElementById('save-indicator');
            if (indicator) indicator.style.display = 'none';
        }
    }

    function stopRecord() {
        isRecording = false;
        canvas.removeEventListener('click', recordHandler);
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

    function recordHandler(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

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

        header.onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            startX = e.clientX - panel.offsetLeft;
            startY = e.clientY - panel.offsetTop;
        };

        document.onmousemove = (e) => {
            if (!isDragging) return;
            const x = Math.max(0, Math.min(e.clientX - startX, window.innerWidth - panel.offsetWidth));
            const y = Math.max(0, Math.min(e.clientY - startY, window.innerHeight - panel.offsetHeight));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
            panel.style.right = 'auto';
        };

        document.onmouseup = () => isDragging = false;
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
