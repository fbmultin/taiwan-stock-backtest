import React, { useState, useEffect, useMemo, useRef } from 'react';
import TW_STOCK_NAMES from './data/twStockNames';
import TW_STOCK_SPLITS from './data/twStockSplits';
import DcaOptimizer from './DcaOptimizer';
import {
  fetchStockPriceData,
  fetchIndexPriceData,
  fetchStockDisplayName,
} from './dataCache';
import { isNonTradingDay, getLastCompletedTradingDay } from './tradingCalendar';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  Calendar,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Clock,
  CloudLightning,