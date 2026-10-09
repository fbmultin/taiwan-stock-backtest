// tradingCalendar:getEffectiveTodayDateStr——假日「今天」退回最近一個交易日
import { getEffectiveTodayDateStr } from './tradingCalendar';

test('交易日就是今天本身', () => {
  // 2026-10-07(三)是交易日
  expect(getEffectiveTodayDateStr(new Date('2026-10-07T03:00:00Z'))).toBe('2026-10-07');
});

test('週末退回最近一個交易日;10/09(五)當年恰好是國慶日補假,連著一起跳過', () => {
  // 2026-10-09(五)是國定假日(國慶日補假),所以 2026-10-10(六)、2026-10-11(日)
  // 都該退回再往前的 2026-10-08(四)。
  expect(getEffectiveTodayDateStr(new Date('2026-10-10T03:00:00Z'))).toBe('2026-10-08');
  expect(getEffectiveTodayDateStr(new Date('2026-10-11T03:00:00Z'))).toBe('2026-10-08');
});

test('國定假日退回最近一個交易日,連假則一路往前跳到開盤那天', () => {
  // 2026-02-16~2026-02-20 是除夕到春節初三的連假(見 TW_MARKET_HOLIDAYS),
  // 連假中任何一天都該退回連假前最後一個交易日 2026-02-13(五,春節調整假前)。
  // 2026-02-13 本身也是調整假(放假但補班前一天上班),往前跳到 2026-02-12 也還是調整假,
  // 真正的交易日是 2026-02-11(三)。
  expect(getEffectiveTodayDateStr(new Date('2026-02-18T03:00:00Z'))).toBe('2026-02-11');
});

test('不管一天中的哪個時間點,只要是非交易日就一律退回同一個交易日', () => {
  const morning = getEffectiveTodayDateStr(new Date('2026-10-10T00:30:00Z'));
  const evening = getEffectiveTodayDateStr(new Date('2026-10-10T23:30:00Z'));
  expect(morning).toBe('2026-10-08');
  expect(evening).toBe('2026-10-08');
});
