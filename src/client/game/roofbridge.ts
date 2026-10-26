// The bunker's container roofs: containers that touch only at a corner would leave a hole in the roof between them, so a small flat patch bridges it. Pure geometry, so it is unit-tested under Node.

/**
 * Where a small flat patch must bridge a corner: two roof cells that touch only at a corner (the two cells beside that corner are not roof). `cells` are "x,y" keys, `cell` the cell size in metres, a
 * cell x spanning (x - 0.5) * cell to (x + 0.5) * cell.
 */
export function cornerBridges(cells: ReadonlySet<string>, cell: number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    for (const dz of [1, -1]) {
      if (!cells.has(`${x + 1},${y + dz}`) || cells.has(`${x + 1},${y}`) || cells.has(`${x},${y + dz}`)) continue;
      out.push({ x: (x + 0.5) * cell, z: (y + (dz > 0 ? 0.5 : -0.5)) * cell });
    }
  }
  return out;
}
