(function () {
    const L = window.Laya;
    if (!L || !L.stage) {
      console.error('Laya.stage 不存在');
      return;
    }
  
    const lines = [];
    const maxDepth = 12;
    const maxChildren = 200;
  
    function val(v) {
      if (v === undefined || v === null || v === '') return '';
      return String(v).replace(/\s+/g, ' ').slice(0, 80);
    }
  
    function textOf(n) {
      const parts = [];
      ['name', 'text', 'label', 'title', 'toolTip', 'skin', 'url'].forEach(k => {
        try {
          const v = val(n[k]);
          if (v) parts.push(`${k}=${JSON.stringify(v)}`);
        } catch (_) {}
      });
      try {
        if (n.texture && n.texture.url) parts.push(`texture=${JSON.stringify(val(n.texture.url))}`);
      } catch (_) {}
      return parts.join(' ');
    }
  
    function ownerOf(n) {
      try {
        const o = n.$owner;
        if (!o) return '';
        const type = o.constructor && o.constructor.name || 'Owner';
        const parts = [`owner=${type}`];
        ['name', 'text', 'title', 'tooltips', 'selectedIndex', 'numItems'].forEach(k => {
          try {
            const v = val(o[k]);
            if (v !== '') parts.push(`${k}=${JSON.stringify(v)}`);
          } catch (_) {}
        });
        return parts.join(' ');
      } catch (_) {
        return '';
      }
    }
  
    function eventsOf(n) {
      try {
        if (!n._events) return '';
        return 'events=' + Object.keys(n._events).join(',');
      } catch (_) {
        return '';
      }
    }
  
    function posOf(n) {
      const keys = ['x', 'y', 'width', 'height', 'visible', 'alpha', 'scaleX', 'scaleY', 'mouseEnabled', 'zOrder'];
      const parts = [];
      keys.forEach(k => {
        try {
          const v = n[k];
          if (typeof v === 'number') parts.push(`${k}=${Math.round(v * 100) / 100}`);
          else if (typeof v === 'boolean') parts.push(`${k}=${v}`);
        } catch (_) {}
      });
      return parts.join(' ');
    }
  
    function walk(n, depth, index) {
      if (!n || depth > maxDepth) return;
  
      const indent = '  '.repeat(depth);
      const type = n.constructor && n.constructor.name || 'Unknown';
      const childCount = (() => {
        try { return n.numChildren || 0; } catch (_) { return 0; }
      })();
  
      lines.push(
        `${indent}[${index}] ${type} children=${childCount} ${posOf(n)} ${textOf(n)} ${ownerOf(n)} ${eventsOf(n)}`
          .replace(/\s+/g, ' ')
          .trim()
      );
  
      const count = Math.min(childCount, maxChildren);
      for (let i = 0; i < count; i++) {
        try {
          walk(n.getChildAt(i), depth + 1, i);
        } catch (e) {
          lines.push(`${indent}  [${i}] <error: ${e.message}>`);
        }
      }
      if (childCount > maxChildren) {
        lines.push(`${indent}  ... ${childCount - maxChildren} more children`);
      }
    }
  
    walk(L.stage, 0, 0);
  
    const output = lines.join('\n');
    console.error(output);
  
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(output)
        .then(() => console.error(`已复制 Laya 节点树，共 ${lines.length} 行`))
        .catch(() => console.error(`复制失败，请手动复制。共 ${lines.length} 行`));
    } else {
      console.error(`浏览器不支持自动复制，请手动复制。共 ${lines.length} 行`);
    }
  })();