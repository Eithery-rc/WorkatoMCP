import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { EventEmitter } from 'events';
import { ProfileRegistry } from './profile-registry';

class FakeSocket extends EventEmitter {
  public close = jest.fn();
  public send = jest.fn();
}

describe('ProfileRegistry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('does not write profile lifecycle logs to stdout', () => {
    const stdoutLog = jest.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('console.log writes to native messaging stdout');
    });
    const stderrLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const registry = new ProfileRegistry();
    const socket = new FakeSocket();

    expect(() => registry.register('dev', socket)).not.toThrow();
    socket.emit('close');

    expect(stdoutLog).not.toHaveBeenCalled();
    expect(stderrLog).toHaveBeenCalled();
  });
});
