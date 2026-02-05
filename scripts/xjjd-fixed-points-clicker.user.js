// ==UserScript==
// @name         固定点位循环点击器
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  按固定点位（百分比坐标）循环点击，跨分辨率一致
// @author       xyk
// @match        https://www.wanyiwan.top/*
// @grant        none
// @run-at       document-end
// @updateURL    https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-fixed-points-clicker.user.js
// @downloadURL  https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-fixed-points-clicker.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.location.href.indexOf('gameIframe') === -1) {
        return;
    }

    const CONFIG = {
        clickDelay: 300,   // 每个点击间隔（毫秒）
        loopDelay: 2000,   // 每轮循环之间的延迟（毫秒）
    };

    // ---------- 内置固定点位（你用录制器测好后，点「导出固定点位」复制，粘贴到下面数组里，别人安装脚本就能直接用）----------
    const DEFAULT_POINTS = [
        // 示例：{ x: 50, y: 30 } 表示 canvas 宽 50%、高 30% 的位置
        // 用录制器录完点「导出固定点位」，把复制的内容替换掉这个数组即可
    ];

    const STORAGE_KEY = 'xjjd_fixed_points';
    let canvas = null;
    let isPlaying = false;
    let points = [];  // [{ x, y }] 百分比 0-100

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
            if (area > 100 && area > maxArea) {
                maxArea = area;
                largest = c;
            }
        }
        return largest;
    }

    async function clickAt(canvasEl, x, y) {
        if (!canvasEl) return false;
        const rect = canvasEl.getBoundingClientRect();
        const clientX = rect.left + x;
        const clientY = rect.top + y;
        try {
            let evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('mousedown', true, true, window, 0,
                window.screenX + clientX, window.screenY + clientY,
                clientX, clientY, false, false, false, false, 0, null);
            canvasEl.dispatchEvent(evt);
            await sleep(50);
            evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('mouseup', true, true, window, 0,
                window.screenX + clientX, window.screenY + clientY,
                clientX, clientY, false, false, false, false, 0, null);
            canvasEl.dispatchEvent(evt);
            await sleep(50);
            evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 0,
                window.screenX + clientX, window.screenY + clientY,
                clientX, clientY, false, false, false, false, 0, null);
            canvasEl.dispatchEvent(evt);
        } catch (e) {
            canvasEl.click();
        }
        await sleep(CONFIG.clickDelay);
        return true;
    }

    function loadPoints() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    points = parsed;
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function savePoints() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
        } catch (e) {}
    }

    async function playOnce() {
        if (!canvas || points.length === 0) return;
        const w = canvas.width;
        const h = canvas.height;
        for (let i = 0; i < points.length; i++) {
            if (!isPlaying) break;
            const p = points[i];
            const x = (p.x / 100) * w;
            const y = (p.y / 100) * h;
            updateStatus(`点击 ${i + 1}/${points.length}`);
            await clickAt(canvas, x, y);
        }
    }

    async function playLoop() {
        if (points.length === 0) {
            alert('请先导入点位（用录制器录制后「导出固定点位」，在此点「从剪贴板导入」）');
            return;
        }
        if (!canvas) {
            alert('Canvas 未找到，请等待游戏加载');
            return;
        }
        isPlaying = true;
        let round = 1;
        while (isPlaying) {
            updateStatus(`第 ${round} 轮`);
            await playOnce();
            round++;
            if (isPlaying) await sleep(CONFIG.loopDelay);
        }
        updateStatus('已停止');
    }

    function stopPlay() {
        isPlaying = false;
    }

    function updateStatus(text) {
        const el = document.getElementById('fpc-status');
        if (el) el.textContent = text;
    }

    function updateCount() {
        const el = document.getElementById('fpc-count');
        if (el) el.textContent = points.length;
    }

    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'fpc-panel';
        panel.style.cssText = 'position:fixed;top:80px;right:20px;width:220px;background:rgba(30,30,30,0.95);border:1px solid #444;border-radius:8px;padding:12px;z-index:99999;font-family:sans-serif;color:#eee;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;cursor:move;">
                <span style="font-weight:bold;">📍 固定点位</span>
                <button id="fpc-hide" style="background:none;border:none;color:#888;cursor:pointer;font-size:16px;">✖</button>
            </div>
            <div style="margin-bottom:8px;color:#aaa;">
                点位：<span id="fpc-count">0</span> 个（百分比坐标，跨分辨率一致）
            </div>
            <button id="fpc-import" style="width:100%;padding:10px;margin:4px 0;background:#2196F3;color:white;border:none;border-radius:5px;cursor:pointer;font-size:13px;">
                📋 从剪贴板导入
            </button>
            <button id="fpc-start" style="width:100%;padding:12px;margin:4px 0;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;font-weight:bold;">
                ▶️ 开始循环
            </button>
            <button id="fpc-stop" style="width:100%;padding:12px;margin:4px 0;background:#FF9800;color:white;border:none;border-radius:5px;cursor:pointer;font-size:14px;display:none;">
                ⏸️ 停止
            </button>
            <div id="fpc-status" style="margin-top:10px;padding-top:8px;border-top:1px solid #444;color:#aaa;font-size:12px;">就绪</div>
        `;
        document.body.appendChild(panel);

        document.getElementById('fpc-import').onclick = async () => {
            try {
                const text = await navigator.clipboard.readText();
                const arr = JSON.parse(text);
                if (!Array.isArray(arr) || arr.some(p => typeof p.x !== 'number' || typeof p.y !== 'number')) {
                    alert('剪贴板内容不是有效的点位数组，请用录制器的「导出固定点位」复制');
                    return;
                }
                points = arr;
                savePoints();
                updateCount();
                updateStatus('已导入 ' + points.length + ' 个点位');
            } catch (e) {
                alert('读取剪贴板失败或格式错误：' + e.message);
            }
        };

        document.getElementById('fpc-start').onclick = () => {
            document.getElementById('fpc-start').style.display = 'none';
            document.getElementById('fpc-stop').style.display = 'block';
            playLoop();
        };

        document.getElementById('fpc-stop').onclick = () => {
            stopPlay();
            document.getElementById('fpc-start').style.display = 'block';
            document.getElementById('fpc-stop').style.display = 'none';
        };

        document.getElementById('fpc-hide').onclick = () => {
            panel.style.display = 'none';
            createShowButton();
        };

        let drag = false, dx, dy;
        panel.querySelector('div').onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            drag = true;
            dx = e.clientX - panel.offsetLeft;
            dy = e.clientY - panel.offsetTop;
        };
        document.addEventListener('mousemove', function move(e) {
            if (!drag) return;
            panel.style.left = (e.clientX - dx) + 'px';
            panel.style.top = (e.clientY - dy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { drag = false; }, { once: false });
    }

    function createShowButton() {
        const btn = document.createElement('button');
        btn.textContent = '📍 固定点位';
        btn.style.cssText = 'position:fixed;top:80px;right:20px;padding:8px 12px;background:rgba(30,30,30,0.9);color:#4CAF50;border:1px solid #4CAF50;border-radius:6px;cursor:pointer;z-index:99998;font-size:12px;';
        btn.onclick = () => {
            btn.remove();
            document.getElementById('fpc-panel').style.display = 'block';
        };
        document.body.appendChild(btn);
    }

    function init() {
        canvas = findCanvas();
        loadPoints();
        // 若本地没存过点位，用脚本里写死的 DEFAULT_POINTS（你测好后写进去，别人安装即用）
        if (points.length === 0 && DEFAULT_POINTS.length > 0) {
            points = DEFAULT_POINTS.slice();
        }
        createPanel();
        updateCount();
        if (!canvas) {
            updateStatus('等待 Canvas...');
            const t = setInterval(() => {
                canvas = findCanvas();
                if (canvas) {
                    clearInterval(t);
                    updateStatus('就绪');
                }
            }, 500);
        } else {
            updateStatus('就绪');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
