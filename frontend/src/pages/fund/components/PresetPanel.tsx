import { useState } from 'react'
import { Button, Card, Empty, Popconfirm, Space, Tag, theme, Tooltip } from 'antd'
import { CheckCircleFilled, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { summarizeFilters } from '../constants'
import PresetNameModal from './PresetNameModal'
import type { QueryPreset } from '../types'

interface Props {
  presets: QueryPreset[]
  activeId: number | null
  onApply: (preset: QueryPreset) => void
  onRename: (id: number, name: string) => void
  onDelete: (id: number) => void
  onClear: () => void
}

export default function PresetPanel({
  presets,
  activeId,
  onApply,
  onRename,
  onDelete,
  onClear,
}: Props) {
  const { token } = theme.useToken()
  // 正在重命名的预设（null 表示模态关闭）
  const [renaming, setRenaming] = useState<QueryPreset | null>(null)

  return (
    <Card
      size="small"
      title="条件预设"
      className="fund-preset-panel"
      extra={
        <Space size="small">
          <span className="text-xs text-gray-400">{presets.length} 个预设</span>
          {activeId != null && (
            <Button size="small" type="text" onClick={onClear}>
              清除选择
            </Button>
          )}
        </Space>
      }
    >
      {presets.length === 0 ? (
        <>
          <div className="fund-preset-empty-desktop">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无预设，在下方筛选区设好条件后点「另存为预设」创建"
            />
          </div>
          <p className="fund-preset-empty-mobile">暂无预设。筛选基金后可保存常用条件。</p>
        </>
      ) : (
        <div className="fund-preset-grid">
          {presets.map((p) => {
            const summary = summarizeFilters(p.filters ?? {})
            const active = p.id === activeId
            return (
              <div
                key={p.id}
                className="fund-preset-card group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border transition-colors"
                style={{
                  borderColor: active ? token.colorPrimary : 'rgba(255,255,255,0.10)',
                  background: active ? token.colorPrimaryBg : 'rgba(255,255,255,0.02)',
                }}
              >
                <button
                  type="button"
                  className="fund-preset-apply"
                  onClick={() => onApply(p)}
                  aria-pressed={active}
                  title={`应用预设「${p.name}」`}
                  style={{ color: token.colorText }}
                >
                  <span className="fund-preset-name" title={p.name}>
                    {active && (
                      <CheckCircleFilled style={{ color: token.colorPrimary, fontSize: 13 }} />
                    )}
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="fund-preset-summary">
                    {summary.length ? (
                      <span className="flex flex-wrap content-start gap-1">
                        {summary.map((s, i) => (
                          <Tag key={i} className="m-0 max-w-full truncate" title={s}>
                            {s}
                          </Tag>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">无条件（全部基金）</span>
                    )}
                  </span>
                </button>
                <Space size={0} className={`fund-preset-actions${active ? ' is-active' : ''}`}>
                  <Tooltip title="重命名">
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      aria-label={`重命名预设「${p.name}」`}
                      onClick={() => setRenaming(p)}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="删除该预设？"
                    onConfirm={() => onDelete(p.id)}
                    onCancel={() => undefined}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`删除预设「${p.name}」`}
                    />
                  </Popconfirm>
                </Space>
              </div>
            )
          })}
        </div>
      )}

      <PresetNameModal
        open={renaming !== null}
        title="重命名预设"
        initialName={renaming?.name}
        onOk={(name) => {
          if (renaming) onRename(renaming.id, name)
          setRenaming(null)
        }}
        onCancel={() => setRenaming(null)}
      />
    </Card>
  )
}
