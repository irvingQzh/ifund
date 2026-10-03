import { useEffect, useRef, useState } from 'react'
import { Button, InputNumber, Select } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { COMPARE_FIELDS as FIELDS, COMPARE_OP_OPTIONS as OP_OPTIONS } from '../constants'
import type { CompareCondition, CompareOp } from '../types'

interface Row {
  op: CompareOp
  value: number | null
}

type RowMap = Record<string, Row[]>

/** 由外部 conditions 重建「每字段至少一行」的内部行模型。 */
function buildRows(conditions: CompareCondition[]): RowMap {
  const map: RowMap = {}
  for (const f of FIELDS) map[f.key] = []
  for (const c of conditions) {
    if (!map[c.field]) map[c.field] = []
    map[c.field].push({ op: c.op, value: c.value })
  }
  for (const f of FIELDS) if (map[f.key].length === 0) map[f.key] = [{ op: 'gt', value: null }]
  return map
}

/** 把行模型压成 conditions（丢弃未填值的行）。 */
function flatten(rows: RowMap): CompareCondition[] {
  const out: CompareCondition[] = []
  for (const f of FIELDS) {
    for (const r of rows[f.key] ?? []) {
      if (r.value !== null && r.value !== undefined) {
        out.push({ field: f.key, op: r.op, value: r.value })
      }
    }
  }
  return out
}

interface Props {
  value: CompareCondition[]
  onChange: (next: CompareCondition[]) => void
}

export default function MultiCompareFilter({ value, onChange }: Props) {
  const [rows, setRows] = useState<RowMap>(() => buildRows(value))
  // 记录自身最近一次 emit 的签名，用于区分「外部预设变更」与「自身编辑」
  const lastEmit = useRef<string>(JSON.stringify(value))

  useEffect(() => {
    const sig = JSON.stringify(value)
    if (sig === lastEmit.current) return // 自身触发，保留空行不重建
    lastEmit.current = sig
    setRows(buildRows(value))
  }, [value])

  const emit = (next: RowMap) => {
    setRows(next)
    const conds = flatten(next)
    lastEmit.current = JSON.stringify(conds)
    onChange(conds)
  }

  const setRow = (key: string, idx: number, patch: Partial<Row>) => {
    const list = (rows[key] ?? []).map((r, i) => (i === idx ? { ...r, ...patch } : r))
    emit({ ...rows, [key]: list })
  }

  const addRow = (key: string) => {
    emit({ ...rows, [key]: [...(rows[key] ?? []), { op: 'gt', value: null }] })
  }

  const removeRow = (key: string, idx: number) => {
    const list = (rows[key] ?? []).filter((_, i) => i !== idx)
    emit({ ...rows, [key]: list.length ? list : [{ op: 'gt', value: null }] })
  }

  return (
    <div className="fund-compare-grid">
      {FIELDS.map((f) => (
        <div key={f.key} className="fund-compare-field">
          <div className="fund-compare-label">{f.label}</div>
          <div className="fund-compare-rows">
            {(rows[f.key] ?? []).map((r, idx) => (
              <div className="fund-compare-row-controls" key={idx}>
                <Select<CompareOp>
                  aria-label={`${f.label}第 ${idx + 1} 个条件的比较方式`}
                  className="fund-compare-op"
                  size="small"
                  value={r.op}
                  options={OP_OPTIONS}
                  onChange={(op) => setRow(f.key, idx, { op })}
                />
                <InputNumber
                  aria-label={`${f.label}第 ${idx + 1} 个条件的数值`}
                  className="fund-compare-value"
                  size="small"
                  placeholder="值"
                  value={r.value}
                  onChange={(v) => setRow(f.key, idx, { value: v as number | null })}
                />
                {idx === 0 ? (
                  <Button
                    aria-label={`为${f.label}增加条件`}
                    size="small"
                    type="text"
                    icon={<PlusOutlined />}
                    onClick={() => addRow(f.key)}
                  />
                ) : (
                  <Button
                    aria-label={`删除${f.label}第 ${idx + 1} 个条件`}
                    size="small"
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeRow(f.key, idx)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
