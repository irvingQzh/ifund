import { Tooltip } from 'antd'
import type { ClusterIndustry } from './types'

// 簇内 top 行业占比条形（按占比归一到最大值，横向比例条）
export default function IndustryBar({ items }: { items: ClusterIndustry[] }) {
  if (!items.length) return null
  const max = Math.max(...items.map((i) => i.ratio), 1)
  return (
    <div className="qfund-industry-bars">
      {items.map((it) => (
        <div className="qfund-industry-row" key={it.label}>
          <span className="qfund-industry-name" title={it.label}>
            {it.label}
          </span>
          <div className="qfund-industry-track">
            <Tooltip title={`平均持仓 ${it.ratio.toFixed(2)}%`}>
              <div
                style={{
                  width: `${(it.ratio / max) * 100}%`,
                  background: '#1677ff',
                  height: '100%',
                  borderRadius: 3,
                }}
              />
            </Tooltip>
          </div>
          <span className="qfund-industry-value">{it.ratio.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  )
}
