import { createHash, randomInt } from 'crypto';

// Алфавит без визуально неоднозначных символов (0/O, 1/I/L) — код вводят руками из Telegram.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genResetCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
