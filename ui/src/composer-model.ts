import { MAX_TEXT } from "../../shared/limits.js";

/** Do not split a surrogate pair when an overflowing paste contains emoji. */
export function fitMessageInsertion(value: string, start: number, end: number, inserted: string) {
  const room = Math.max(0, MAX_TEXT - (value.length - (end - start)));
  let accepted = inserted.slice(0, room);
  const last = accepted.charCodeAt(accepted.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) accepted = accepted.slice(0, -1);
  return {
    value: value.slice(0, start) + accepted + value.slice(end),
    caret: start + accepted.length,
    blocked: inserted.length - accepted.length,
  };
}
