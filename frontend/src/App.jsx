import { useMemo, useState, useCallback } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Program, AnchorProvider, web3, BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./App.css";

// ⚠️ Replace after deployment:  anchor deploy --provider.cluster devnet
const PROGRAM_ID = new PublicKey("EnergyTokenProgramID11111111111111111111111");
const MINT_ADDRESS = new PublicKey("YOUR_MINT_ADDRESS_AFTER_INIT"); // set after initialize
const TOKEN_PRICE_SOL = 0.01; // 1 kWh = 0.01 SOL

// Mock analytics data
const MOCK_ANALYTICS = [
  { month: "Jan", produced: 420, consumed: 310 },
  { month: "Feb", produced: 380, consumed: 290 },
  { month: "Mar", produced: 510, consumed: 400 },
  { month: "Apr", produced: 630, consumed: 510 },
  { month: "May", produced: 720, consumed: 580 },
  { month: "Jun", produced: 890, consumed: 710 },
];

// ─── Inner App (needs wallet context) ───────────────────────────────────────
function EnergyApp() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [tokenBalance, setTokenBalance] = useState(null);
  const [solBalance, setSolBalance] = useState(null);
  const [mintAmount, setMintAmount] = useState(100);
  const [buyAmount, setBuyAmount] = useState(10);
  const [sendAmount, setSendAmount] = useState(5);
  const [sendTo, setSendTo] = useState("");
  const [txStatus, setTxStatus] = useState(null);
  const [txLog, setTxLog] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  const provider = useMemo(() => {
    if (!wallet.publicKey) return null;
    return new AnchorProvider(connection, wallet, {
      preflightCommitment: "confirmed",
    });
  }, [connection, wallet]);

  const addLog = useCallback((msg, type = "info") => {
    const entry = { msg, type, time: new Date().toLocaleTimeString() };
    setTxLog((prev) => [entry, ...prev].slice(0, 10));
    setTxStatus(entry);
  }, []);

  const fetchBalances = useCallback(async () => {
    if (!wallet.publicKey || !connection) return;
    try {
      const sol = await connection.getBalance(wallet.publicKey);
      setSolBalance((sol / LAMPORTS_PER_SOL).toFixed(4));

      try {
        const ata = await getAssociatedTokenAddress(MINT_ADDRESS, wallet.publicKey);
        const info = await connection.getTokenAccountBalance(ata);
        setTokenBalance(info.value.uiAmount);
      } catch {
        setTokenBalance(0);
      }
    } catch (e) {
      console.error(e);
    }
  }, [wallet.publicKey, connection]);

  // ── Mint tokens (producer flow) ──
  const handleMint = useCallback(async () => {
    if (!provider || !wallet.publicKey) return;
    setIsLoading(true);
    addLog(`Minting ${mintAmount} kWh tokens...`, "pending");
    try {
      // In production: call program.methods.mintEnergyTokens(new BN(mintAmount)).rpc()
      await new Promise((r) => setTimeout(r, 2000)); // simulate tx
      const fakeSig = `${Math.random().toString(36).slice(2)}...${Math.random().toString(36).slice(2)}`;
      addLog(`✅ Minted ${mintAmount} kWh! Tx: ${fakeSig}`, "success");
      setTokenBalance((prev) => (parseFloat(prev || 0) + mintAmount));
    } catch (e) {
      addLog(`❌ Mint failed: ${e.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  }, [provider, wallet.publicKey, mintAmount, addLog]);

  // ── Buy tokens ──
  const handleBuy = useCallback(async () => {
    if (!provider || !wallet.publicKey) return;
    setIsLoading(true);
    const cost = (buyAmount * TOKEN_PRICE_SOL).toFixed(4);
    addLog(`Buying ${buyAmount} kWh for ${cost} SOL...`, "pending");
    try {
      await new Promise((r) => setTimeout(r, 2000));
      const fakeSig = `${Math.random().toString(36).slice(2)}...${Math.random().toString(36).slice(2)}`;
      addLog(`✅ Bought ${buyAmount} kWh for ${cost} SOL! Tx: ${fakeSig}`, "success");
      setTokenBalance((prev) => (parseFloat(prev || 0) + buyAmount));
      setSolBalance((prev) => (parseFloat(prev || 0) - parseFloat(cost)).toFixed(4));
    } catch (e) {
      addLog(`❌ Buy failed: ${e.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  }, [provider, wallet.publicKey, buyAmount, addLog]);

  // ── Send tokens ──
  const handleSend = useCallback(async () => {
    if (!provider || !wallet.publicKey) return;
    if (!sendTo) { addLog("❌ Enter a recipient address", "error"); return; }
    setIsLoading(true);
    addLog(`Sending ${sendAmount} kWh to ${sendTo.slice(0, 8)}...`, "pending");
    try {
      await new Promise((r) => setTimeout(r, 2000));
      const fakeSig = `${Math.random().toString(36).slice(2)}...${Math.random().toString(36).slice(2)}`;
      addLog(`✅ Sent ${sendAmount} kWh to ${sendTo.slice(0, 8)}! Tx: ${fakeSig}`, "success");
      setTokenBalance((prev) => Math.max(0, parseFloat(prev || 0) - sendAmount));
    } catch (e) {
      addLog(`❌ Transfer failed: ${e.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  }, [provider, wallet.publicKey, sendAmount, sendTo, addLog]);

  const maxBarValue = Math.max(...MOCK_ANALYTICS.map((d) => d.produced));

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">EnergyToken</span>
          </div>
          <span className="logo-sub">kWh Marketplace · Devnet</span>
        </div>
        <div className="header-right">
          <WalletMultiButton />
        </div>
      </header>

      {!wallet.connected ? (
        <div className="connect-screen">
          <div className="connect-card">
            <div className="connect-icon">⚡</div>
            <h1>Tokenized Energy Marketplace</h1>
            <p>Trade real electricity as Solana tokens.<br />1 token = 1 kWh · Powered by Anchor</p>
            <WalletMultiButton />
            <div className="connect-features">
              <span>🌱 Mint kWh tokens as a producer</span>
              <span>⚡ Buy & sell energy peer-to-peer</span>
              <span>🔗 All ownership 100% on-chain</span>
            </div>
          </div>
        </div>
      ) : (
        <main className="main">
          {/* Tabs */}
          <nav className="tabs">
            {["dashboard", "produce", "trade", "analytics"].map((tab) => (
              <button
                key={tab}
                className={`tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "dashboard" && "📊 Dashboard"}
                {tab === "produce" && "🌱 Produce"}
                {tab === "trade" && "⚡ Trade"}
                {tab === "analytics" && "📈 Analytics"}
              </button>
            ))}
          </nav>

          {/* Balance Bar */}
          <div className="balance-bar">
            <div className="balance-item">
              <span className="balance-label">Wallet</span>
              <span className="balance-value mono">{wallet.publicKey?.toBase58().slice(0, 8)}...</span>
            </div>
            <div className="balance-item">
              <span className="balance-label">SOL Balance</span>
              <span className="balance-value">{solBalance ?? "—"} SOL</span>
            </div>
            <div className="balance-item highlight">
              <span className="balance-label">kWh Tokens</span>
              <span className="balance-value">{tokenBalance ?? "—"} kWh</span>
            </div>
            <button className="refresh-btn" onClick={fetchBalances}>⟳ Refresh</button>
          </div>

          {/* Status Banner */}
          {txStatus && (
            <div className={`status-banner ${txStatus.type}`}>
              <span>{txStatus.msg}</span>
              <button onClick={() => setTxStatus(null)}>×</button>
            </div>
          )}

          {/* Tab Content */}
          {activeTab === "dashboard" && (
            <div className="panel-grid">
              <div className="panel">
                <h2>⚡ Market Overview</h2>
                <div className="stat-grid">
                  <div className="stat"><div className="stat-val">0.01</div><div className="stat-lbl">SOL / kWh</div></div>
                  <div className="stat"><div className="stat-val">12,450</div><div className="stat-lbl">Total Minted</div></div>
                  <div className="stat"><div className="stat-val">8,320</div><div className="stat-lbl">Total Traded</div></div>
                  <div className="stat"><div className="stat-val">47</div><div className="stat-lbl">Producers</div></div>
                </div>
              </div>

              <div className="panel">
                <h2>🕐 Recent Activity</h2>
                <div className="activity-list">
                  {txLog.length === 0 ? (
                    <p className="empty">No transactions yet. Start trading!</p>
                  ) : (
                    txLog.map((entry, i) => (
                      <div key={i} className={`activity-item ${entry.type}`}>
                        <span className="activity-time">{entry.time}</span>
                        <span className="activity-msg">{entry.msg}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="panel wide">
                <h2>🏪 Active Listings</h2>
                <table className="listings-table">
                  <thead>
                    <tr><th>Seller</th><th>Amount (kWh)</th><th>Price/kWh</th><th>Total</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>8xFg...3kPq</td><td>500</td><td>0.009 SOL</td><td>4.5 SOL</td><td><button className="btn-sm">Buy</button></td></tr>
                    <tr><td>2aRt...7mLz</td><td>200</td><td>0.010 SOL</td><td>2.0 SOL</td><td><button className="btn-sm">Buy</button></td></tr>
                    <tr><td>5cNk...1wEv</td><td>1000</td><td>0.008 SOL</td><td>8.0 SOL</td><td><button className="btn-sm">Buy</button></td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "produce" && (
            <div className="panel-grid">
              <div className="panel">
                <h2>🌱 Mint Energy Tokens</h2>
                <p className="panel-desc">As an energy producer, mint kWh tokens representing electricity you've generated.</p>
                <div className="form-group">
                  <label>Amount to Mint (kWh)</label>
                  <div className="input-row">
                    <input
                      type="number"
                      value={mintAmount}
                      min={1}
                      max={10000}
                      onChange={(e) => setMintAmount(Number(e.target.value))}
                    />
                    <span className="input-unit">kWh</span>
                  </div>
                  <div className="presets">
                    {[50, 100, 500, 1000].map((v) => (
                      <button key={v} className="preset" onClick={() => setMintAmount(v)}>{v}</button>
                    ))}
                  </div>
                </div>
                <div className="info-box">
                  <span>⚡ {mintAmount} kWh tokens</span>
                  <span>will be minted to your wallet</span>
                </div>
                <button
                  className="action-btn mint"
                  onClick={handleMint}
                  disabled={isLoading}
                >
                  {isLoading ? "Processing..." : `⚡ Mint ${mintAmount} kWh`}
                </button>
              </div>

              <div className="panel">
                <h2>📋 Create Sell Listing</h2>
                <p className="panel-desc">List your kWh tokens on the marketplace for other users to buy.</p>
                <div className="form-group">
                  <label>Tokens to List</label>
                  <input type="number" defaultValue={100} min={1} />
                </div>
                <div className="form-group">
                  <label>Price per kWh (SOL)</label>
                  <input type="number" defaultValue={0.01} min={0.001} step={0.001} />
                </div>
                <div className="info-box">
                  <span>🔒 Tokens locked in escrow until sold or cancelled</span>
                </div>
                <button className="action-btn list" disabled={isLoading}>
                  🏪 Create Listing
                </button>
              </div>
            </div>
          )}

          {activeTab === "trade" && (
            <div className="panel-grid">
              <div className="panel">
                <h2>⚡ Buy Energy Tokens</h2>
                <p className="panel-desc">Purchase kWh tokens from the marketplace at the fixed rate.</p>
                <div className="form-group">
                  <label>Amount to Buy (kWh)</label>
                  <div className="input-row">
                    <input
                      type="number"
                      value={buyAmount}
                      min={1}
                      onChange={(e) => setBuyAmount(Number(e.target.value))}
                    />
                    <span className="input-unit">kWh</span>
                  </div>
                  <div className="presets">
                    {[5, 10, 50, 100].map((v) => (
                      <button key={v} className="preset" onClick={() => setBuyAmount(v)}>{v}</button>
                    ))}
                  </div>
                </div>
                <div className="info-box">
                  <span>💰 Cost: {(buyAmount * TOKEN_PRICE_SOL).toFixed(4)} SOL</span>
                  <span>Rate: 0.01 SOL / kWh</span>
                </div>
                <button
                  className="action-btn buy"
                  onClick={handleBuy}
                  disabled={isLoading}
                >
                  {isLoading ? "Processing..." : `💰 Buy ${buyAmount} kWh`}
                </button>
              </div>

              <div className="panel">
                <h2>📤 Send Tokens</h2>
                <p className="panel-desc">Transfer kWh tokens to another wallet peer-to-peer.</p>
                <div className="form-group">
                  <label>Recipient Address</label>
                  <input
                    type="text"
                    placeholder="Solana wallet address..."
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Amount (kWh)</label>
                  <div className="input-row">
                    <input
                      type="number"
                      value={sendAmount}
                      min={1}
                      onChange={(e) => setSendAmount(Number(e.target.value))}
                    />
                    <span className="input-unit">kWh</span>
                  </div>
                </div>
                <div className="info-box">
                  <span>🔗 P2P transfer — no platform fee</span>
                </div>
                <button
                  className="action-btn send"
                  onClick={handleSend}
                  disabled={isLoading}
                >
                  {isLoading ? "Processing..." : `📤 Send ${sendAmount} kWh`}
                </button>
              </div>
            </div>
          )}

          {activeTab === "analytics" && (
            <div className="panel-grid">
              <div className="panel wide">
                <h2>📈 Energy Production vs Consumption (Mock Data)</h2>
                <div className="chart">
                  {MOCK_ANALYTICS.map((d) => (
                    <div key={d.month} className="chart-col">
                      <div className="bar-group">
                        <div className="bar produced" style={{ height: `${(d.produced / maxBarValue) * 180}px` }} title={`${d.produced} kWh produced`} />
                        <div className="bar consumed" style={{ height: `${(d.consumed / maxBarValue) * 180}px` }} title={`${d.consumed} kWh consumed`} />
                      </div>
                      <div className="chart-label">{d.month}</div>
                      <div className="chart-vals">
                        <span className="produced-val">{d.produced}</span>
                        <span className="consumed-val">{d.consumed}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="chart-legend">
                  <span><span className="legend-dot produced" />Produced kWh</span>
                  <span><span className="legend-dot consumed" />Consumed kWh</span>
                </div>
              </div>

              <div className="panel">
                <h2>🏆 Top Producers</h2>
                <div className="leaderboard">
                  {[
                    { addr: "8xFg...3kPq", kwh: 4200, rank: 1 },
                    { addr: "2aRt...7mLz", kwh: 3100, rank: 2 },
                    { addr: "5cNk...1wEv", kwh: 2800, rank: 3 },
                    { addr: "9pQr...6jHs", kwh: 1950, rank: 4 },
                  ].map((p) => (
                    <div key={p.rank} className="leader-row">
                      <span className="rank">#{p.rank}</span>
                      <span className="addr mono">{p.addr}</span>
                      <span className="kwh-val">{p.kwh.toLocaleString()} kWh</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel">
                <h2>⚡ Network Stats</h2>
                <div className="stat-grid">
                  <div className="stat"><div className="stat-val">3,330</div><div className="stat-lbl">Surplus kWh</div></div>
                  <div className="stat"><div className="stat-val">67%</div><div className="stat-lbl">Renewable Mix</div></div>
                  <div className="stat"><div className="stat-val">124 SOL</div><div className="stat-lbl">Revenue Distributed</div></div>
                  <div className="stat"><div className="stat-val">98.2%</div><div className="stat-lbl">Uptime</div></div>
                </div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

// ─── Root with Providers ─────────────────────────────────────────────────────
export default function App() {
  const endpoint = useMemo(() => clusterApiUrl("devnet"), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <EnergyApp />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
