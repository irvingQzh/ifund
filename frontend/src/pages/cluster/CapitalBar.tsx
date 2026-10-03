import { Tooltip } from 'antd'
import type { CapitalStock } from './types'

// 簇实际资金暴露条形：按占簇内总重仓市值的比例排布（规模加权，绿色区别于行业蓝条）
export default function CapitalBar({ stocks }: { stocks: CapitalStock[] }) {
  if (!stocks.length) return null
  const max = Math.max(...stocks.map((s) => s.mv_pct), 1)
  return (
    <div className="qfund-capital-bars">
      {stocks.map((s) => (
        <div className="qfund-capital-row" key={s.code}>
          <span className="qfund-capital-name" title={s.name}>
            {s.name}
          </span>
          <div className="qfund-capital-track">
            <Tooltip title={`${s.industry} · 簇内 ${s.overlap} 只基金持有`}>
              <div
                style={{
                  width: `${(s.mv_pct / max) * 100}%`,
                  background: '#52c41a',
                  height: '100%',
                  borderRadius: 3,
                }}
              />
            </Tooltip>
          </div>
          <span className="qfund-capital-value">
            {s.mv_yi.toFixed(2)} 亿 · {s.mv_pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}
