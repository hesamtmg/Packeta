import { CaptchaService } from './captcha.service';

// The digits are never sent as plain text — only baked into the SVG
// image's <text> nodes (see CaptchaService.renderImage) — so recovering
// them to test against means decoding the same data: URI a real browser
// would rasterize, then reading the glyphs back out in order.
function extractDigits(image: string): string {
  const base64 = image.replace('data:image/svg+xml;base64,', '');
  const svg = Buffer.from(base64, 'base64').toString('utf8');
  return [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)]
    .map((match) => match[1])
    .join('');
}

describe('CaptchaService', () => {
  it('accepts the exact digit sequence and rejects a wrong one, across many random draws', () => {
    const service = new CaptchaService();

    for (let i = 0; i < 50; i++) {
      const wrong = service.generate();
      const wrongDigits = extractDigits(wrong.image);
      const tampered =
        wrongDigits.slice(0, -1) + ((Number(wrongDigits.at(-1)) + 1) % 10);
      expect(service.verify(wrong.captchaId, tampered)).toBe(false);

      const correct = service.generate();
      expect(
        service.verify(correct.captchaId, extractDigits(correct.image)),
      ).toBe(true);
    }
  });

  it('rejects a captcha id that was already used once', () => {
    const service = new CaptchaService();
    const { captchaId, image } = service.generate();
    const answer = extractDigits(image);

    expect(service.verify(captchaId, answer)).toBe(true);
    expect(service.verify(captchaId, answer)).toBe(false);
  });

  it('rejects an unknown captcha id', () => {
    const service = new CaptchaService();
    expect(service.verify('not-a-real-id', '42')).toBe(false);
  });

  it('rejects an answer with the wrong number of digits', () => {
    const service = new CaptchaService();
    const { captchaId } = service.generate();
    expect(service.verify(captchaId, '1')).toBe(false);
  });

  it('renders the challenge as an SVG data URI, never as a plain-text field', () => {
    const service = new CaptchaService();
    const { image } = service.generate();

    expect(image.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = Buffer.from(
      image.replace('data:image/svg+xml;base64,', ''),
      'base64',
    ).toString('utf8');
    expect(svg).toContain('<svg');
    expect(extractDigits(image)).toMatch(/^\d{5}$/);
  });
});
