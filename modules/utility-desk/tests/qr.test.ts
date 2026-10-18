import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { buildQrPayload, qrOptions, type QrType, type QrValues } from '../src/domain/qr/qr';

const payloads = [
  buildQrPayload('wifi', { ssid: 'บ้าน;Guest,"\\:Net', password: '  p;ass,"\\:word  ', security: 'WPA', hidden: true }),
  buildQrPayload('wifi', { ssid: 'Guest', security: 'nopass', password: 'ignored' }),
  buildQrPayload('email', { email: 'test+tag@example.com', subject: 'Hello & ไทย', body: 'Line 1\nLine 2?' }),
  buildQrPayload('phone', { phone: '+66 (81) 234-5678' }),
  buildQrPayload('sms', { phone: '+66 81 234 5678', message: 'Hi & hello\nবাংলা' }),
  buildQrPayload('contact', { firstName: 'ไทย', lastName: 'Example', organization: 'Team; A, B', contactPhone: '+66 81 234 5678', contactEmail: 'test@example.com', website: 'https://example.com/?a=1&b=2' }),
];

describe('QR generation', () => {
  for (const text of ['https://example.com/path?q=a%26b#test', 'Hello বাংলা ไทย 🌱', '  exact spacing\nline two  ', ...payloads]) {
    it(`encodes exact text: ${text}`, async () => {
      const opts = qrOptions(text, { size: 512, level: 'M' });
      const code = QRCode.create(text, opts);
      const scale = 8,
        edge = (code.modules.size + opts.margin * 2) * scale;
      const pixels = new Uint8ClampedArray(edge * edge * 4).fill(255);
      for (let y = 0; y < edge; y++)
        for (let x = 0; x < edge; x++) {
          const row = Math.floor(y / scale) - opts.margin,
            col = Math.floor(x / scale) - opts.margin;
          if (row >= 0 && col >= 0 && row < code.modules.size && col < code.modules.size && code.modules.get(row, col)) {
            const i = (y * edge + x) * 4;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
          }
        }
      expect(jsQR(pixels, edge, edge)?.data).toBe(text);
      const svg = await QRCode.toString(text, { ...opts, type: 'svg' });
      expect(svg).toContain('<svg');
      expect(svg).not.toContain(text);
    });
  }
  it('validates empty content, excessive data and unsupported options', () => {
    expect(() => qrOptions(' ', { size: 512, level: 'M' })).toThrow(/Enter/);
    expect(() => qrOptions('🌱'.repeat(1000), { size: 512, level: 'M' })).toThrow(/UTF-8/);
    expect(() => qrOptions('a'.repeat(2000), { size: 512, level: 'H' })).toThrow(/correction/);
    expect(() => qrOptions('hello', { size: 10, level: 'M' })).toThrow(/supported/);
  });
});

describe('QR content types', () => {
  it('keeps exact Wi-Fi names/passwords and escapes separators', () => {
    expect(payloads[0]).toBe('WIFI:T:WPA;S:บ้าน\\;Guest\\,\\"\\\\\\:Net;P:  p\\;ass\\,\\"\\\\\\:word  ;H:true;;');
    expect(payloads[1]).toBe('WIFI:T:nopass;S:Guest;H:false;;');
    expect(buildQrPayload('wifi', { ssid: 'Old network', password: 'abcde', security: 'WEP' })).toBe('WIFI:T:WEP;S:Old network;P:abcde;H:false;;');
  });
  it('builds email, telephone and SMS actions without query injection', () => {
    expect(payloads[2]).toBe('mailto:test%2Btag@example.com?subject=Hello%20%26%20%E0%B9%84%E0%B8%97%E0%B8%A2&body=Line%201%0ALine%202%3F');
    expect(payloads[3]).toBe('tel:+66812345678');
    expect(payloads[4]).toBe('sms:+66812345678?body=Hi%20%26%20hello%0A%E0%A6%AC%E0%A6%BE%E0%A6%82%E0%A6%B2%E0%A6%BE');
    expect(buildQrPayload('email', { email: 'a@example.com' })).toBe('mailto:a@example.com');
    expect(buildQrPayload('sms', { phone: '12345' })).toBe('sms:12345');
    expect(buildQrPayload('text', { text: '  exact\ntext  ' })).toBe('  exact\ntext  ');
  });
  it('escapes contact field injection and folds long Unicode lines by bytes', () => {
    const card = buildQrPayload('contact', { firstName: 'ไทย'.repeat(12), lastName: 'A;B,C\\D', organization: 'Team\nTEL:123' });
    expect(card).toContain('BEGIN:VCARD\r\nVERSION:3.0\r\n');
    expect(card.replace(/\r\n /g, '')).toContain('N:A\\;B\\,C\\\\D;');
    expect(card).toContain('ORG:Team\\nTEL:123\r\nEND:VCARD\r\n');
    for (const line of card.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(payloads[5]).toContain('TEL:+66812345678\r\nEMAIL:test@example.com\r\nURL:https://example.com/?a=1&b=2\r\n');
  });
  it('validates required and malformed fields for the selected type only', () => {
    for (const values of [{}, { ssid: 'Guest' }, { ssid: 'Guest', security: 'unknown' }, { ssid: 'bad\nname', security: 'nopass' }]) expect(() => buildQrPayload('wifi', values)).toThrow();
    for (const email of ['', 'bad address', 'a@example.com?subject=injected', 'a\nb@example.com']) expect(() => buildQrPayload('email', { email })).toThrow(/email/);
    for (const phone of ['', 'abc', '+12;ext=1', '12\n34']) expect(() => buildQrPayload('phone', { phone })).toThrow(/phone/);
    expect(() => buildQrPayload('contact', {})).toThrow(/name/);
    expect(() => buildQrPayload('contact', { firstName: 'A', website: 'https://example.com/\nTEL:123' })).toThrow(/website/);
    expect(() => buildQrPayload('contact', { firstName: 'A', website: 'javascript:alert(1)' })).toThrow(/website/);
    expect(buildQrPayload('wifi', { ssid: 'Guest', security: 'nopass', password: '\nignored', email: 'invalid' })).toBe(payloads[1]);
  });
});

// Copied from webapps/utility-desk/tests/qr.test.cjs ("payload vectors shared with the browser app stay fixed for every QR type").
// Apps never import each other, so each keeps its own copy: change both files together.
const sharedVectors: [QrType, QrValues, string][] = [
  ['text', { text: 'https://example.com/?a=1&b=2' }, 'https://example.com/?a=1&b=2'],
  ['text', { text: '  exact\ntext  ' }, '  exact\ntext  '],
  ['wifi', { ssid: 'Home', security: 'WPA', password: 'p;a:ss', hidden: false }, 'WIFI:T:WPA;S:Home;P:p\\;a\\:ss;H:false;;'],
  ['wifi', { ssid: 'Guest', security: 'nopass', password: 'ignored', hidden: true }, 'WIFI:T:nopass;S:Guest;H:true;;'],
  ['wifi', { ssid: 'Old', security: 'WEP', password: 'abcde' }, 'WIFI:T:WEP;S:Old;P:abcde;H:false;;'],
  ['email', { email: 'a@example.com' }, 'mailto:a@example.com'],
  ['email', { email: 'a+b@example.com', subject: 'Hi & bye', body: 'One\nTwo?' }, 'mailto:a%2Bb@example.com?subject=Hi%20%26%20bye&body=One%0ATwo%3F'],
  ['phone', { phone: '+66 (81) 234-5678' }, 'tel:+66812345678'],
  ['sms', { phone: '12345' }, 'sms:12345'],
  ['sms', { phone: '+66 81 234 5678', message: 'Hi & hello' }, 'sms:+66812345678?body=Hi%20%26%20hello'],
  [
    'contact',
    { firstName: 'Ada', lastName: 'Lovelace', organization: 'Analytical; Engines, Ltd', contactPhone: '+44 20 7946 0000', contactEmail: 'ada@example.com', website: 'https://example.com/?a=1&b=2' },
    'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nFN:Ada Lovelace\r\nORG:Analytical\\; Engines\\, Ltd\r\nTEL:+442079460000\r\nEMAIL:ada@example.com\r\nURL:https://example.com/?a=1&b=2\r\nEND:VCARD\r\n',
  ],
  ['contact', { firstName: 'Ada' }, 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Ada;;;\r\nFN:Ada\r\nEND:VCARD\r\n'],
];

describe('payload vectors shared with Utility Desk', () => {
  it.each(sharedVectors)('builds the fixed %s payload %#', (type, values, expected) => {
    expect(buildQrPayload(type, values)).toBe(expected);
  });
});
