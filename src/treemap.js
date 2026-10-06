// Squarified treemap(Bruls et al.):把一串有大小的項目排進長方形,讓每格盡量接近正方形,
// 面積嚴格正比於 value。熱力圖用它排版。純函式,方便測試。
//
// items: [{ key, value }](value <= 0 的會被忽略,不然會產生面積 0 的格子)
// 回傳: [{ key, value, x, y, w, h }],依 value 由大到小。
export function squarify(items, x, y, w, h) {
  const list = (items || [])
    .filter((it) => it && it.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value);
  const total = list.reduce((s, it) => s + it.value, 0);
  if (list.length === 0 || total <= 0 || w <= 0 || h <= 0) return [];
  // 先把 value 換算成面積
  const scale = (w * h) / total;
  const nodes = list.map((it) => ({ ...it, area: it.value * scale }));
  const out = [];

  // 這一排(row)沿著短邊排,算最差的長寬比;越接近 1 越好
  const worst = (row, side) => {
    const sum = row.reduce((s, n) => s + n.area, 0);
    const max = Math.max(...row.map((n) => n.area));
    const min = Math.min(...row.map((n) => n.area));
    const s2 = side * side;
    return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
  };

  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(rw, rh);
    const row = [nodes[i]];
    let j = i + 1;
    while (j < nodes.length && worst(row.concat(nodes[j]), side) <= worst(row, side)) {
      row.push(nodes[j]);
      j += 1;
    }
    const rowArea = row.reduce((s, n) => s + n.area, 0);
    if (rw >= rh) {
      // 在左邊切出一條直排
      const colW = rowArea / rh;
      let cy = ry;
      row.forEach((n) => {
        const ch = n.area / colW;
        out.push({ key: n.key, value: n.value, x: rx, y: cy, w: colW, h: ch });
        cy += ch;
      });
      rx += colW;
      rw -= colW;
    } else {
      // 在上方切出一條橫排
      const rowH = rowArea / rw;
      let cx = rx;
      row.forEach((n) => {
        const cw = n.area / rowH;
        out.push({ key: n.key, value: n.value, x: cx, y: ry, w: cw, h: rowH });
        cx += cw;
      });
      ry += rowH;
      rh -= rowH;
    }
    i = j;
  }
  return out;
}
