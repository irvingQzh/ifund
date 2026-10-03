import { Tooltip } from 'antd'
import CapitalBar from './CapitalBar'
import IndustryBar from './IndustryBar'
import type { Cluster, ClusterFund, Holding, SecondaryStock, SignatureStock } from './types'

// 主要特征股：浅蓝底深字（重叠数蓝色）
function PrimaryChip({ stock }: { stock: SignatureStock }) {
  return (
    <Tooltip title={`簇内 ${stock.overlap} 只基金持有 · 超基线 +${stock.edge}%`}>
      <div
        style={{
          border: '1px solid #2b4acb',
          background: '#e6f0ff',
          borderRadius: 6,
          padding: '4px 10px',
          lineHeight: 1.3,
        }}
      >
        <div style={{ fontWeight: 600, color: 'rgba(0,0,0,0.88)' }}>
          {stock.name}
          <span style={{ fontWeight: 400, fontSize: 11, color: '#2b4acb', marginLeft: 4 }}>
            ×{stock.overlap}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{stock.industry}</div>
      </div>
    </Tooltip>
  )
}

// 次要重叠股：透明底灰字（暗色/亮色主题均可读）
function SecondaryChip({ stock }: { stock: SecondaryStock }) {
  return (
    <Tooltip title={`簇内 ${stock.overlap} 只基金持有`}>
      <div
        style={{
          border: '1px solid rgba(140,140,140,0.35)',
          borderRadius: 6,
          padding: '4px 10px',
          lineHeight: 1.3,
        }}
      >
        <div style={{ color: '#8c8c8c' }}>
          {stock.name}
          <span style={{ fontSize: 11, marginLeft: 4 }}>×{stock.overlap}</span>
        </div>
        <div style={{ fontSize: 11, color: '#8c8c8c' }}>{stock.industry}</div>
      </div>
    </Tooltip>
  )
}

// 单只持仓 chip：股票名 + 份额 + 申万三级（边框风格，文字继承主题色）
function HoldingChip({ holding }: { holding: Holding }) {
  return (
    <span
      style={{
        border: '1px solid rgba(140,140,140,0.35)',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 12,
        display: 'inline-flex',
        gap: 6,
        alignItems: 'baseline',
      }}
    >
      <span>{holding.name}</span>
      <b>{holding.ratio.toFixed(2)}%</b>
      <span style={{ color: '#8c8c8c', fontSize: 11 }}>{holding.industry}</span>
    </span>
  )
}

// 单只基金：左侧基本信息 + 右侧前十大持仓
function FundRow({ fund }: { fund: ClusterFund }) {
  return (
    <div
      className="qfund-cluster-fund-row"
      style={{
        padding: '10px 0',
        borderBottom: '1px solid rgba(140,140,140,0.15)',
      }}
    >
      <div className="qfund-cluster-fund-info">
        <div style={{ fontWeight: 600 }}>{fund.name}</div>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>{fund.code}</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>综合分 {fund.score.toFixed(3)}</div>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
          Sharpe {fund.sharpe_3y == null ? '-' : fund.sharpe_3y.toFixed(2)}
          {fund.scale != null ? ` · ${fund.scale.toFixed(2)} 亿` : ''}
        </div>
      </div>
      <div className="qfund-cluster-fund-holdings">
        {fund.holdings.length ? (
          fund.holdings.map((h) => <HoldingChip key={h.code} holding={h} />)
        ) : (
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>无股票持仓</span>
        )}
      </div>
    </div>
  )
}

// 单个簇：特征股（主要+次要，带重叠数）+ 行业占比条 + 簇内基金（右侧平铺持仓）
export default function ClusterCard({ cluster }: { cluster: Cluster }) {
  const hasStocks = cluster.signature_stocks.length || cluster.secondary_stocks.length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {hasStocks ? (
        <div>
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>
            代表股票（×N = 簇内持有该股的基金数；蓝色为主要特征股，灰色为次要重叠股）
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {cluster.signature_stocks.map((s) => (
              <PrimaryChip key={s.code} stock={s} />
            ))}
            {cluster.secondary_stocks.map((s) => (
              <SecondaryChip key={s.code} stock={s} />
            ))}
          </div>
        </div>
      ) : null}

      {cluster.top_industries.length ? (
        <div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>
            行业暴露（簇内平均持仓 · 占比平权）
          </div>
          <IndustryBar items={cluster.top_industries} />
        </div>
      ) : null}

      {cluster.capital_exposure.stocks.length ? (
        <div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>
            实际资金暴露（规模加权 · 簇内重仓合计 {cluster.capital_exposure.total_yi.toFixed(0)} 亿 ·
            仅 top10 重仓口径，会低估非重仓股）
          </div>
          <CapitalBar stocks={cluster.capital_exposure.stocks} />
        </div>
      ) : null}

      <div>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
          簇内基金（右侧为各基金前十大持仓 · 份额 · 申万三级）
        </div>
        {cluster.funds.map((f) => (
          <FundRow key={f.code} fund={f} />
        ))}
      </div>
    </div>
  )
}
