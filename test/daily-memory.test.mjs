import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDailyMemory } from '../src/daily-memory.js';

const T0 = new Date('2026-10-23T12:00:00+08:00');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daily-'));
}

test('默认关闭：不建目录、不写文件', () => {
  const dir = path.join(tempDir(), 'daily');
  const dm = createDailyMemory({ memory: { enabled: false, dailyDir: dir } });
  assert.equal(dm.enabled, false);
  assert.equal(dm.event({ withId: 'private:1', direction: 'in', at: T0 }), null);
  assert.equal(fs.existsSync(dir), false);
});

test('事件：按日期落 qq.jsonl，不存正文', () => {
  const dir = path.join(tempDir(), 'daily');
  const dm = createDailyMemory({ memory: { enabled: true, dailyDir: dir } });
  const file = dm.event({ withId: 'private:1001', direction: 'in', length: 12, at: T0 });
  assert.ok(fs.existsSync(file));
  const line = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(line.platform, 'qq');
  assert.equal(line.direction, 'in');
  assert.equal(line.length, 12);
  assert.equal(line.source, 'bridge');
  assert.equal('text' in line, false);
  assert.equal('summary' in line, false);
});

test('摘要：只存 ≤200 字，kind 校验', () => {
  const dir = path.join(tempDir(), 'daily');
  const dm = createDailyMemory({ memory: { enabled: true, dailyDir: dir } });
  const long = 'x'.repeat(300);
  dm.note({ key: 'private:1002', text: long, kind: 'promise', at: T0 });
  dm.note({ key: 'private:1002', text: '普通摘要', kind: 'not-a-kind', at: T0 });
  const lines = fs.readFileSync(dm.dayDir(T0) + '/qq.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines[0].summary.length, 200);
  assert.equal(lines[0].kind, 'promise');
  assert.equal(lines[1].kind, 'note');
  assert.equal(lines[1].summary, '普通摘要');
});

test('跨天分目录', () => {
  const dir = path.join(tempDir(), 'daily');
  const dm = createDailyMemory({ memory: { enabled: true, dailyDir: dir } });
  dm.event({ withId: 'private:1003', direction: 'out', at: T0 });
  dm.event({ withId: 'private:1003', direction: 'in', at: new Date('2026-10-24T09:00:00+08:00') });
  assert.ok(fs.existsSync(path.join(dir, '2026-10', '2026-10-23', 'qq.jsonl')));
  assert.ok(fs.existsSync(path.join(dir, '2026-10', '2026-10-24', 'qq.jsonl')));
});
