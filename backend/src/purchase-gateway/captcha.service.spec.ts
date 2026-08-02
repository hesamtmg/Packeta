import { CaptchaService } from './captcha.service';

// The challenge is never sent as plain text — only baked into the SVG
// image's <text> nodes (see CaptchaService.renderImage) — so recovering
// the question to test against means decoding the same data: URI a real
// browser would rasterize, then reading the glyphs back out in order.
function extractQuestion(image: string): string {
  const base64 = image.replace('data:image/svg+xml;base64,', '');
  const svg = Buffer.from(base64, 'base64').toString('utf8');
  const glyphs = [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(
    (match) => match[1],
  );
  return glyphs.map(decodeXmlEntity).join('');
}

function decodeXmlEntity(text: string): string {
  switch (text) {
    case '&#215;':
      return '×';
    case '&amp;':
      return '&';
    case '&lt;':
      return '<';
    case '&gt;':
      return '>';
    default:
      return text;
  }
}

// Recomputes the expected answer from the question string using standard
// operator precedence (multiplication before addition/subtraction) — a
// second, independent implementation from the service's own `evaluate`, so
// this actually checks the arithmetic rather than just mirroring it.
function expectedAnswer(question: string): number {
  const [a, op1, b, op2, c] = question.replace(' = ?', '').split(' ');
  const numbers = [Number(a), Number(b), Number(c)];
  const ops = [op1, op2];

  const multIndex = ops.indexOf('×');
  if (multIndex === -1) {
    return apply(apply(numbers[0], ops[0], numbers[1]), ops[1], numbers[2]);
  }
  const product =
    multIndex === 0 ? numbers[0] * numbers[1] : numbers[1] * numbers[2];
  const remaining = multIndex === 0 ? numbers[2] : numbers[0];
  const remainingOp = multIndex === 0 ? ops[1] : ops[0];
  return multIndex === 0
    ? apply(product, remainingOp, remaining)
    : apply(remaining, remainingOp, product);
}

function apply(x: number, op: string, y: number): number {
  return op === '-' ? x - y : op === '+' ? x + y : x * y;
}

describe('CaptchaService', () => {
  it('accepts the operator-precedence-correct answer and rejects a wrong one, across many random draws', () => {
    const service = new CaptchaService();

    for (let i = 0; i < 50; i++) {
      const wrong = service.generate();
      const wrongQuestion = extractQuestion(wrong.image);
      expect(
        service.verify(
          wrong.captchaId,
          String(expectedAnswer(wrongQuestion) + 1),
        ),
      ).toBe(false);

      const correct = service.generate();
      const correctQuestion = extractQuestion(correct.image);
      expect(
        service.verify(
          correct.captchaId,
          String(expectedAnswer(correctQuestion)),
        ),
      ).toBe(true);
    }
  });

  it('rejects a captcha id that was already used once', () => {
    const service = new CaptchaService();
    const { captchaId, image } = service.generate();
    const answer = String(expectedAnswer(extractQuestion(image)));

    expect(service.verify(captchaId, answer)).toBe(true);
    expect(service.verify(captchaId, answer)).toBe(false);
  });

  it('rejects an unknown captcha id', () => {
    const service = new CaptchaService();
    expect(service.verify('not-a-real-id', '42')).toBe(false);
  });

  it('rejects a non-numeric answer', () => {
    const service = new CaptchaService();
    const { captchaId } = service.generate();
    expect(service.verify(captchaId, 'banana')).toBe(false);
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
    expect(extractQuestion(image)).toMatch(/^\d+ . \d+ . \d+ = \?$/);
  });
});
