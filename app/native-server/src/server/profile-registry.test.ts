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

describe('ProfileRegistry active-profile election', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function quietRegistry(): ProfileRegistry {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    return new ProfileRegistry();
  }

  test('elects the remaining profile when the active one disconnects', () => {
    const registry = quietRegistry();
    const first = new FakeSocket();
    const second = new FakeSocket();

    registry.register('centium', first);
    registry.register('bluBanyan', second);
    expect(registry.getActiveProfile()).toBe('centium');

    first.emit('close');

    expect(registry.getConnectedProfiles()).toEqual(['bluBanyan']);
    expect(registry.getActiveProfile()).toBe('bluBanyan');
  });

  test('a non-active profile disconnecting does not move the active one', () => {
    const registry = quietRegistry();
    const first = new FakeSocket();
    const second = new FakeSocket();
    registry.register('centium', first);
    registry.register('bluBanyan', second);

    second.emit('close');

    expect(registry.getActiveProfile()).toBe('centium');
  });

  test('the last profile leaving clears the active profile', () => {
    const registry = quietRegistry();
    const socket = new FakeSocket();
    registry.register('centium', socket);

    socket.emit('close');

    expect(registry.getActiveProfile()).toBeNull();
    expect(registry.getConnectedProfiles()).toEqual([]);
  });

  test('the generation changes on every connect and disconnect', () => {
    const registry = quietRegistry();
    const first = new FakeSocket();
    const start = registry.getGeneration();

    registry.register('centium', first);
    const afterConnect = registry.getGeneration();
    expect(afterConnect).not.toBe(start);

    first.emit('close');
    const afterClose = registry.getGeneration();
    expect(afterClose).not.toBe(afterConnect);

    // A reconnect of the same name is a new browser session, so it must show up.
    registry.register('centium', new FakeSocket());
    expect(registry.getGeneration()).not.toBe(afterClose);
  });
});
