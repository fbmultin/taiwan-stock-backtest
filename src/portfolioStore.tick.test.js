// 台股升降單位(股票/ETF 級距不同)與證交稅率規則
import { tickSize, stepPrice, securityTaxRate, isBondETF } from './portfolioStore';

describe('tickSize', () => {
  test('股票六個級距', () => {
    expect(tickSize(9.99)).toBe(0.01);
    expect(tickSize(10)).toBe(0.05);
    expect(tickSize(49.95)).toBe(0.05);
    expect(tickSize(50)).toBe(0.1);
    expect(tickSize(100)).toBe(0.5);
    expect(tickSize(500)).toBe(1);
    expect(tickSize(1000)).toBe(5);
  });
  test('ETF 只有兩個級距:未滿50元 0.01、50元以上 0.05', () => {
    expect(tickSize(15.3, true)).toBe(0.01);
    expect(tickSize(49.99, true)).toBe(0.01);
    expect(tickSize(50, true)).toBe(0.05);
    expect(tickSize(150, true)).toBe(0.05);
  });
});

describe('stepPrice', () => {
  test('00945B(債券ETF,約15元)每次跳 0.01,不是股票的 0.05', () => {
    expect(stepPrice(15.3, 1, true)).toBe(15.31);
    expect(stepPrice(15.3, -1, true)).toBe(15.29);
    expect(stepPrice(15.3, 1, false)).toBe(15.35);
  });
  test('跨級距邊界', () => {
    expect(stepPrice(49.95, 1)).toBe(50);
    expect(stepPrice(50, 1)).toBe(50.1);
    expect(stepPrice(50, -1)).toBe(49.95);
    expect(stepPrice(10, -1)).toBe(9.99);
    expect(stepPrice(100, -1)).toBe(99.9);
    expect(stepPrice(1000, -1)).toBe(999);
    expect(stepPrice(995, 1)).toBe(996);
    expect(stepPrice(999, 1)).toBe(1000);
    expect(stepPrice(49.99, 1, true)).toBe(50);
    expect(stepPrice(50, -1, true)).toBe(49.99);
    expect(stepPrice(50, 1, true)).toBe(50.05);
  });
  test('不在檔位上的價格先對齊到合法檔位', () => {
    expect(stepPrice(12.03, 1)).toBe(12.05);
    expect(stepPrice(12.03, -1)).toBe(12);
    expect(stepPrice(50.03, 1, true)).toBe(50.05);
    expect(stepPrice(50.03, -1, true)).toBe(50);
  });
  test('0 以下不會變負數', () => {
    expect(stepPrice(0, -1)).toBe(0);
    expect(stepPrice(0.01, -1, true)).toBe(0);
    expect(stepPrice(0, 1)).toBe(0.01);
  });
});

describe('securityTaxRate', () => {
  test('債券ETF代號判斷', () => {
    expect(isBondETF('00945B')).toBe(true);
    expect(isBondETF('00679b')).toBe(true);
    expect(isBondETF('0050')).toBe(false);
    expect(isBondETF('00631L')).toBe(false);
  });
  test('股票 0.3%、當沖減半 0.15%(期限內)、ETF 0.1% 不因當沖減半', () => {
    expect(securityTaxRate({ date: '2026-10-06' })).toBe(0.003);
    expect(securityTaxRate({ isDayTrade: true, date: '2026-10-06' })).toBe(0.0015);
    expect(securityTaxRate({ isDayTrade: true, date: '2028-01-02' })).toBe(0.003);
    expect(securityTaxRate({ isEtf: true, date: '2026-10-06' })).toBe(0.001);
    expect(securityTaxRate({ isEtf: true, isDayTrade: true, date: '2026-10-06' })).toBe(0.001);
  });
  test('債券ETF停徵到期日之前免稅,之後回到 0.1%', () => {
    expect(securityTaxRate({ isEtf: true, isBondEtf: true, date: '2026-12-31' })).toBe(0);
    expect(securityTaxRate({ isEtf: true, isBondEtf: true, date: '2027-01-04' })).toBe(0.001);
  });
});
