import React, { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useMarketData } from '../hooks/useMarketData';
import TradingViewWidget from './TradingViewWidget';
import OrderBook from './OrderBook';
import TradeHistory from './TradeHistory';
import OrderForm from './OrderForm';
import PositionsPanel from './PositionsPanel';
import AccountSummary from './AccountSummary';
import TradingBotPanel from './TradingBotPanel';
import CopyTradingPanel from './CopyTradingPanel';

const AdvancedTradingInterface = () => {
  const [activeTab, setActiveTab] = useState('spot');
  const [selectedSymbol, setSelectedSymbol] = useState('BTC/USDT');
  const [orderType, setOrderType] = useState('limit');
  const [leverage, setLeverage] = useState(10);
  
  const { connected, sendMessage } = useWebSocket();
  const { prices, orderBook, trades, positions, balance } = useMarketData(selectedSymbol);

  // Trading panel configuration
  const tradingPanels = {
    spot: { name: 'Spot Trading', component: SpotTradingPanel },
    futures: { name: 'Futures', component: FuturesTradingPanel },
    perpetual: { name: 'Perpetual', component: PerpetualTradingPanel },
    margin: { name: 'Margin', component: MarginTradingPanel },
    bots: { name: 'Trading Bots', component: TradingBotPanel },
    copy: { name: 'Copy Trading', component: CopyTradingPanel }
  };

  const ActivePanel = tradingPanels[activeTab]?.component || SpotTradingPanel;

  return (
    <div className="nexec-trading-interface">
      {/* Header */}
      <div className="trading-header">
        <div className="market-selector">
          <h1>NEX'EC Exchange</h1>
          <select 
            value={selectedSymbol} 
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="symbol-selector"
          >
            <optgroup label="Major Cryptos">
              <option value="BTC/USDT">BTC/USDT</option>
              <option value="ETH/USDT">ETH/USDT</option>
              <option value="SOL/USDT">SOL/USDT</option>
            </optgroup>
            <optgroup label="Memecoins">
              <option value="DOGE/USDT">DOGE/USDT</option>
              <option value="SHIB/USDT">SHIB/USDT</option>
              <option value="PEPE/USDT">PEPE/USDT</option>
            </optgroup>
            <optgroup label="Stocks">
              <option value="TSLA/USD">TSLA/USD</option>
              <option value="AAPL/USD">AAPL/USD</option>
            </optgroup>
          </select>
        </div>

        <div className="market-data">
          <span className="price">${prices[selectedSymbol]?.price?.toFixed(2) || '0.00'}</span>
          <span className={`change ${prices[selectedSymbol]?.change >= 0 ? 'positive' : 'negative'}`}>
            {prices[selectedSymbol]?.change?.toFixed(2) || '0.00'}%
          </span>
          <span className="volume">24h Vol: ${(prices[selectedSymbol]?.volume / 1000000).toFixed(2)}M</span>
        </div>

        <div className="user-actions">
          <AccountSummary balance={balance} />
        </div>
      </div>

      {/* Main Trading Area */}
      <div className="trading-layout">
        {/* Left Panel - Chart */}
        <div className="chart-section">
          <TradingViewWidget symbol={selectedSymbol} interval="1h" />
        </div>

        {/* Center Panel - Trading Interface */}
        <div className="trading-section">
          <div className="trading-tabs">
            {Object.entries(tradingPanels).map(([key, { name }]) => (
              <button
                key={key}
                className={`tab-button ${activeTab === key ? 'active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="trading-panel">
            <ActivePanel
              symbol={selectedSymbol}
              orderType={orderType}
              setOrderType={setOrderType}
              leverage={leverage}
              setLeverage={setLeverage}
              onPlaceOrder={(order) => sendMessage({
                action: 'place_order',
                ...order
              })}
            />
          </div>
        </div>

        {/* Right Panel - Market Data */}
        <div className="market-data-section">
          <OrderBook data={orderBook} />
          <TradeHistory trades={trades} />
          <PositionsPanel positions={positions} />
        </div>
      </div>

      {/* Bottom Panel - Additional Features */}
      <div className="features-panel">
        <div className="bot-management">
          <h3>Trading Bots</h3>
          <TradingBotPanel />
        </div>

        <div className="copy-trading">
          <h3>Copy Trading</h3>
          <CopyTradingPanel />
        </div>

        <div className="launchpad">
          <h3>Launchpad</h3>
          <LaunchpadPanel />
        </div>
      </div>
    </div>
  );
};

// Specialized Trading Panels
const SpotTradingPanel = ({ symbol, orderType, setOrderType, onPlaceOrder }) => (
  <div className="spot-trading">
    <OrderForm
      symbol={symbol}
      orderType={orderType}
      setOrderType={setOrderType}
      onPlaceOrder={onPlaceOrder}
      showLeverage={false}
    />
  </div>
);

const FuturesTradingPanel = ({ symbol, orderType, setOrderType, leverage, setLeverage, onPlaceOrder }) => (
  <div className="futures-trading">
    <LeverageSelector leverage={leverage} setLeverage={setLeverage} />
    <OrderForm
      symbol={symbol}
      orderType={orderType}
      setOrderType={setOrderType}
      onPlaceOrder={onPlaceOrder}
      showLeverage={true}
      leverage={leverage}
    />
    <FuturesInfo symbol={symbol} />
  </div>
);

export default AdvancedTradingInterface;
