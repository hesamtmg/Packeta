import { CaptchaService } from './captcha.service';

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
      expect(
        service.verify(
          wrong.captchaId,
          String(expectedAnswer(wrong.question) + 1),
        ),
      ).toBe(false);

      const correct = service.generate();
      expect(
        service.verify(
          correct.captchaId,
          String(expectedAnswer(correct.question)),
        ),
      ).toBe(true);
    }
  });

  it('rejects a captcha id that was already used once', () => {
    const service = new CaptchaService();
    const { captchaId, question } = service.generate();
    const answer = String(expectedAnswer(question));

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
});
