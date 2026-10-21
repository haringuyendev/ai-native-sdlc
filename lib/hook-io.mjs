export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim() ? JSON.parse(raw) : {};
}

export function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

export async function runHook(main) {
  try {
    await main(await readInput());
  } catch (e) {
    process.stderr.write(`[ai-native-sdlc] hook lỗi, bỏ qua: ${e?.message ?? String(e)}\n`);
    process.exit(0);
  }
}
