const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0 O I L 1

export function generateInviteCode(): string {
  let body = ''
  for (let i = 0; i < 8; i++) body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!
  return `XC${body}`
}
