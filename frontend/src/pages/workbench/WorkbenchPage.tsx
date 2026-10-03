import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, Select, Tabs } from 'antd'
import request from '../../api/request'
import type { QueryPreset } from '../fund/types'
import MirrorView from '../screen/MirrorView'
import ClusterView from '../cluster/ClusterView'
import PositionView from '../position/PositionView'
import './workbench-mobile.css'

// 组合分析工作台：三类分析（镜像基金 / 聚类 / 仓位）共享同一个预设镜像，
// 选择预设后自动运行聚类和仓位分析；用 Tab 切换不同视图。
export default function WorkbenchPage() {
  const [presets, setPresets] = useState<QueryPreset[]>([])
  const [presetId, setPresetId] = useState<number | null>(null)
  const [tab, setTab] = useState('mirror')
  const clusterRef = useRef<{ run: () => Promise<void> }>(null)
  const positionRef = useRef<{ run: () => Promise<void> }>(null)

  useEffect(() => {
    request
      .get('/fund/presets')
      .then(({ data }) => setPresets(data.items ?? data ?? []))
      .catch(() => undefined)
  }, [])

  // 重跑聚类 + 仓位分析（预设变化、或镜像更新后调用）
  const rerun = useCallback(() => {
    if (!presetId) return
    setTimeout(() => {
      clusterRef.current?.run()
      positionRef.current?.run()
    }, 100)
  }, [presetId])

  // 预设变化时自动运行聚类和仓位分析
  useEffect(() => {
    rerun()
  }, [rerun])

  return (
    <div className="qfund-workbench">
      <Card size="small" className="qfund-workbench-preset">
        <div className="qfund-workbench-preset-row">
          <label htmlFor="qfund-workbench-preset-select">选择预设</label>
          <Select
            id="qfund-workbench-preset-select"
            placeholder="请选择基金预设条件"
            className="qfund-workbench-preset-select"
            value={presetId ?? undefined}
            onChange={setPresetId}
            options={presets.map((p) => ({ label: p.name, value: p.id }))}
          />
          <span className="qfund-workbench-preset-help">
            镜像基金 → 行业暴露聚类 → 簇级仓位建议，三步共用这一份预设镜像
          </span>
        </div>
      </Card>

      <Tabs
        className="qfund-workbench-tabs"
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'mirror',
            label: '镜像基金',
            children: <MirrorView presetId={presetId} presets={presets} onMirrorSaved={rerun} />,
          },
          {
            key: 'cluster',
            label: '聚类分析',
            // 强制挂载：否则非激活 Tab 懒加载，ref 为 null，预设变化时自动运行扑空
            forceRender: true,
            children: <ClusterView ref={clusterRef} presetId={presetId} />,
          },
          {
            key: 'position',
            label: '仓位建议',
            forceRender: true,
            children: <PositionView ref={positionRef} presetId={presetId} />,
          },
        ]}
      />
    </div>
  )
}
