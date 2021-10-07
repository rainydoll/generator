export function gcd2(x: number, y: number): number {
  while (y) {
    var t = y;
    y = x % y;
    x = t;
  }
  return x;
}

export function lcm2(x: number, y: number): number {
  return x * y / gcd2(x, y);
}

export function lcm(v : number[]): number {
  let r = 0;
  for (const x of v) {
    if (r == 0) r = x;
    else r = lcm2(r, x);
  }
  return r;
}
