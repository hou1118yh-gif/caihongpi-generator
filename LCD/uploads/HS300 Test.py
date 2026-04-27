# -*- coding: utf-8 -*-
# HS300 Test — 聚宽策略：510300 分钟级 — MACD金叉 + RSI + 均线趋势 + 止损止盈
# 回测频率请选「分钟」。笔试题说明见同目录：笔试题解答说明.md
# 原题为股指期货 1 手 + 14:55 前平仓；此处用 ETF + 仓位比例近似，并落实 14:55 强平。

from jqdata import *
import numpy as np
import pandas as pd
import datetime


def _closeable_amount(context, security):
    if security not in context.portfolio.positions:
        return 0
    p = context.portfolio.positions[security]
    c = getattr(p, 'closeable_amount', None)
    if c is not None:
        return int(c)
    return int(p.total_amount)


def initialize(context):
    """回测启动时执行一次：基准、费用、全局参数 g.*"""
    set_benchmark('000300.XSHG')  # 收益对比基准：沪深300指数
    set_option('use_real_price', True)  # 真实价格（复权等）
    set_option('avoid_future_data', True)  # 尽量避免未来函数
    log.set_level('order', 'error')  # 仅订单错误级日志，减少刷屏

    g.security = '510300.XSHG'  # 标的：沪深300ETF

    # ---------- MACD：快慢线与信号线周期 ----------
    g.macd_fast = 8
    g.macd_slow = 21
    g.macd_signal = 9

    # ---------- RSI：周期 + 开平仓阈值 ----------
    g.rsi_window = 14
    g.rsi_buy = 55   # 开仓要求 RSI < 此值，避免超买区追高
    g.rsi_sell = 75  # 持仓时 RSI > 此值 视为超买，可平仓

    # ---------- 趋势：最近 N 根分钟收盘的简单均线 ----------
    g.ma_window = 60

    # ---------- 固定比例止损止盈（相对持仓成本价 avg_cost）----------
    g.stop_loss = 0.015    # 跌超 1.5% 止损
    g.take_profit = 0.03   # 涨超 3% 止盈

    g.position_ratio = 0.6  # 开仓只用可用现金的 60%，不全仓

    g.history_bars = 120    # 每次拉取 120 根 1 分钟 K 线算指标

    set_order_cost(OrderCost(
        open_tax=0, close_tax=0,
        open_commission=0.0003,
        close_commission=0.0003,
        min_commission=5
    ), type='stock')

    set_slippage(PriceRelatedSlippage(0.001))  # 比例滑点，可按需要调大做敏感性测试


# ---------- 指标函数 ----------


def MACD(close, fast, slow, signal):
    """
    返回 MACD 柱：(DIF - DEA) * 2，pandas Series。
    DIF = EMA(快) - EMA(慢)，DEA = EMA(DIF, signal)。
    """
    s = pd.Series(close)
    ema_fast = s.ewm(span=fast).mean()
    ema_slow = s.ewm(span=slow).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal).mean()
    return (dif - dea) * 2


def RSI(close, n):
    """
    经典 RSI（涨跌用 ewm 平滑）。np.diff 使长度比 close 少 1，
    前面补 50 使 rsi 与 close 下标对齐，最后一根用 rsi[-1]。
    """
    delta = np.diff(close)
    up = np.maximum(delta, 0)
    down = np.maximum(-delta, 0)
    roll_up = pd.Series(up).ewm(span=n).mean()
    roll_down = pd.Series(down).ewm(span=n).mean()
    rs = roll_up / (roll_down + 1e-9)
    rsi = 100 - (100 / (1 + rs))
    return np.append([50], rsi)


# ---------- 主逻辑：分钟回测下每分钟调用一次 ----------


def handle_data(context, data):
    security = g.security
    t = context.current_dt.time()

    # 笔试题：14:55 起强制平仓，且之后不再开仓（本分钟只减仓）
    if t >= datetime.time(14, 55):
        if _closeable_amount(context, security) > 0:
            order_target(security, 0)
        return

    # 盘中有效交易时段：9:35～14:54（14:55 及以后已在上文处理）
    if t < datetime.time(9, 35):
        return

    # df=False 得到字典；[:-1] 去掉当前未走完的最后一根 K，减轻「偷价」
    h = attribute_history(security, g.history_bars, '1m', ['close'], df=False)
    close = h['close'][:-1]

    if len(close) < g.ma_window:
        return

    # 当前价：用于止损止盈（与最后一根已收盘 close[-1] 可能略有差异）
    price = data[security].price

    macd = MACD(close, g.macd_fast, g.macd_slow, g.macd_signal)
    rsi = RSI(close, g.rsi_window)

    cur_macd = macd.iloc[-1]   # 上一完整分钟对应的 MACD 柱
    prev_macd = macd.iloc[-2]  # 再往前一根，用于判断「柱刚由负变正」
    cur_rsi = rsi[-1]

    # 趋势均线：截断后 close 的最后 ma_window 根均值
    ma = np.mean(close[-g.ma_window:])

    pos = context.portfolio.positions[security].total_amount if security in context.portfolio.positions else 0
    cash = context.portfolio.available_cash

    # ----- 有仓时优先：止损 / 止盈（仅可卖数量>0 才下单，避免 T+1 报错）-----
    if pos > 0:
        cost = context.portfolio.positions[security].avg_cost
        cl = _closeable_amount(context, security)

        if cl > 0 and price < cost * (1 - g.stop_loss):
            order_target(security, 0)
            return

        if cl > 0 and price > cost * (1 + g.take_profit):
            order_target(security, 0)
            return

    # ----- 空仓：多条件同时满足才开仓 -----
    if pos == 0:
        if (
            close[-1] > ma and                   # 价格在均线上方：顺势
            cur_macd > 0 and prev_macd < 0 and   # MACD 柱金叉（上根≤0、本根>0）
            cur_rsi < g.rsi_buy                  # RSI 未过热
        ):
            order_target_value(security, cash * g.position_ratio)
            return

    # ----- 有仓：信号平仓（任一成立即清仓；须可卖>0）-----
    if pos > 0:
        cl = _closeable_amount(context, security)
        if cl > 0 and (
            cur_macd < 0 or           # 柱翻负：动量转弱
            cur_rsi > g.rsi_sell or   # RSI 超买
            close[-1] < ma            # 收盘跌破均线：趋势破坏
        ):
            order_target(security, 0)
