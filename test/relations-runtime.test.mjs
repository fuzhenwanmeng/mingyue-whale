import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRelationsRuntime } from '../src/relations-runtime.js';

const T0 = new Date('2026-10-23T12:00:00+08:00').getTime();

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rel-runtime-'));
}

test('默认关闭：不记录、不建目录', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: false, dir } });
  assert.equal(rt.enabled, false);
  assert.equal(rt.onInbound({ uin: '1001', at: T0 }), null);
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(rt.errors, []);
});

test('开启后：好友私聊落卡，新好友 48 分（基础 1 + 他先开口 2）', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  const card = rt.onInbound({ uin: '1002', nickname: '测试好友', length: 8, at: T0 });
  assert.equal(card.affinity, 48);
  assert.equal(card.stats.theirInitiations, 1);
  assert.ok(fs.existsSync(path.join(dir, '1002.json')));
  assert.equal(rt.errors.length, 0);
});

test('发出的消息在 10 分钟内 = 回复，不算主动', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, proactiveEnabled: true, dir } });
  rt.onInbound({ uin: '1003', length: 5, at: T0 });
  assert.equal(rt.onOutbound({ uin: '1003', at: T0 + 60_000 }), null);
  const card = rt.store.load('1003');
  assert.equal(card.stats.myInitiations, 0);
});

test('11 分钟后再发 = 主动，计入 myInitiations', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, proactiveEnabled: true, dir } });
  rt.onInbound({ uin: '1004', length: 5, at: T0 });
  const card = rt.onOutbound({ uin: '1004', at: T0 + 11 * 60_000 });
  assert.equal(card.stats.myInitiations, 1);
  assert.ok(card.lastProactive);
});

test('主动开口被关掉时，即使隔很久也不记主动', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, proactiveEnabled: false, dir } });
  rt.onInbound({ uin: '1005', length: 5, at: T0 });
  assert.equal(rt.onOutbound({ uin: '1005', at: T0 + 60 * 60_000 }), null);
  assert.equal(rt.store.load('1005').stats.myInitiations, 0);
});

test('canProactive：新好友 14 天内不允许', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  rt.onInbound({ uin: '1006', length: 5, at: T0 });
  const b = rt.canProactive('1006', T0 + 24 * 3600_000);
  assert.equal(b.allowed, false);
  assert.equal(b.level, 'cool');
});

test('关闭时 canProactive 明确返回 disabled', () => {
  const rt = createRelationsRuntime({ relations: { enabled: false } });
  assert.equal(rt.canProactive('1007').level, 'disabled');
});

test('note：给已有卡片追加摘要，不丢原字段', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  rt.onInbound({ uin: '1008', nickname: '笔记测试', length: 5, at: T0 });
  const card = rt.note('1008', '喜欢猫；聊到工作会烦，别追问', T0 + 1000);
  assert.equal(card.notes.length, 1);
  assert.equal(card.notes[0].text, '喜欢猫；聊到工作会烦，别追问');
  assert.equal(card.affinity, 48);
});

test('precheck：普通回复永远放行', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  rt.onInbound({ uin: '1009', length: 5, at: T0 });
  const gate = rt.precheck('1009', { proactive: false, at: T0 + 60_000 });
  assert.equal(gate.allowed, true);
});

test('precheck：主动被额度拦下并给出原因', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  rt.onInbound({ uin: '1010', length: 5, at: T0 });
  const gate = rt.precheck('1010', { proactive: true, at: T0 + 60_000 });
  assert.equal(gate.allowed, false);
  assert.match(gate.warnings[0], /主动开口被拦/);
});

test('precheck：没有卡片的新朋友，主动被拦、回复放行', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  assert.equal(rt.precheck('1011', { proactive: true, at: T0 }).allowed, false);
  assert.equal(rt.precheck('1011', { proactive: false, at: T0 }).allowed, true);
});

test('isProactiveNow：10 分钟内算回复，超过算主动；无记录按主动', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  rt.onInbound({ uin: '1012', length: 5, at: T0 });
  assert.equal(rt.isProactiveNow('1012', T0 + 60_000), false);
  assert.equal(rt.isProactiveNow('1012', T0 + 11 * 60_000), true);
  assert.equal(rt.isProactiveNow('1013', T0), true);
});

test('touchInbound：拍一拍也算对方来过，回复不被误判为主动', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  rt.onInbound({ uin: '1014', length: 5, at: T0 });
  rt.touchInbound('1014', T0 + 60 * 60_000);
  assert.equal(rt.isProactiveNow('1014', T0 + 60 * 60_000 + 60_000), false);
});

test('当天涨幅封顶：连聊 10 条也只涨 6 分', () => {
  const dir = path.join(tempDir(), 'relations');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  let card = rt.onInbound({ uin: '1015', nickname: '话痨', length: 50, at: T0 });
  for (let i = 0; i < 10; i++) {
    card = rt.onInbound({ uin: '1015', nickname: '话痨', length: 50, at: T0 + (i + 1) * 60_000 });
  }
  assert.equal(card.affinity, 51); // 45 + 6
  assert.equal(card.gainToday, 6);
});

test('旧卡片迁移：v1 的 76 分压到 61，并标记 v2', () => {
  const dir = path.join(tempDir(), 'relations');
  fs.mkdirSync(dir, { recursive: true });
  const legacy = {
    uin: '1016', nickname: '旧卡', affinity: 76, stats: { replies: 30, myInitiations: 0, theirInitiations: 1, ignoredProactives: 0 },
    ignoredStreak: 0, lastInteraction: '2026-10-23T02:00:00.000Z', lastProactive: null, optOut: false, notes: [], lifecycle: 'active'
  };
  fs.writeFileSync(path.join(dir, '1016.json'), JSON.stringify(legacy), 'utf8');
  const rt = createRelationsRuntime({ relations: { enabled: true, dir } });
  const card = rt.cardOf('1016');
  assert.equal(card.affinity, 61);
  assert.equal(card.affinityVersion, 2);
});
