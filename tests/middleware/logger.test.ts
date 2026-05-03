import { describe, expect, test, mock } from 'bun:test';
import { createLogger, withRequestLog } from '../../src/middleware/logger';

describe('createLogger', () => {
  test('produces structured JSON log line', () => {
    const logger = createLogger({ service: 'agent-worker', module: 'test' });
    const lines: string[] = [];
    const mockConsole = mock((line: string) => lines.push(line));

    // Capture console.info
    const origInfo = console.info;
    console.info = mockConsole;

    logger.info('test message', { key: 'value' });

    console.info = origInfo;

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe('info');
    expect(parsed.service).toBe('agent-worker');
    expect(parsed.module).toBe('test');
    expect(parsed.message).toBe('test message');
    expect(parsed.context).toEqual({ key: 'value' });
    expect(parsed.timestamp).toBeDefined();
  });

  test('supports warn and error levels', () => {
    const logger = createLogger({ service: 'agent-worker', module: 'test' });
    const lines: string[] = [];
    const mockConsole = mock((line: string) => lines.push(line));

    const origWarn = console.warn;
    const origError = console.error;
    console.warn = mockConsole;
    console.error = mockConsole;

    logger.warn('warning');
    logger.error('error');

    console.warn = origWarn;
    console.error = origError;

    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).level).toBe('warn');
    expect(JSON.parse(lines[1]).level).toBe('error');
  });
});

describe('withRequestLog', () => {
  test('logs method, path, and duration', async () => {
    const lines: string[] = [];
    const mockConsole = mock((line: string) => lines.push(line));
    const origInfo = console.info;
    console.info = mockConsole;

    const handler = withRequestLog(async () => {
      return new Response('ok');
    }, { service: 'agent-worker' });

    const req = new Request('http://localhost/agent/health');
    await handler(req);

    console.info = origInfo;

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.message).toContain('GET');
    expect(parsed.message).toContain('/agent/health');
    expect(parsed.context.durationMs).toBeDefined();
  });
});
