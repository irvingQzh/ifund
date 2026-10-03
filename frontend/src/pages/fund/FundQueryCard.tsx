import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { Alert, Button, Card, Checkbox, Empty, Input, Pagination, Select, Space, Spin, Table, Tag, theme } from 'antd'
import { DownOutlined, SaveOutlined } from '@ant-design/icons'
import type { SorterResult } from 'antd/es/table/interface'
import MultiCompareFilter from './components/MultiCompareFilter'
import FundExcludeSelect from './components/FundExcludeSelect'
import { buildFundColumns, num } from './components/fundColumns'
import NavTrendModal from './components/NavTrendModal'
import PresetNameModal from './components/PresetNameModal'
import { CONC_META, KIND_META, LUCK_META, metaOf } from './aiMeta'
import './fund-mobile.css'
import type {
  CompareCondition,
  Filters,
  FundItem,
  FundTypeItem,
  QueryPreset,
  SortInfo,
} from './types'

interface Props {
  funds: FundItem[]
  total: number
  loading: boolean
  page: number
  pageSize: number
  filters: Filters
  fundTypes: FundTypeItem[]
  onFiltersChange: (f: Filters) => void
  onPageChange: (page: number, pageSize: number) => void
  onSortChange: (sorters: SortInfo[]) => void
  onSearch: () => void
  onReset: () => void
  onOpenDetail: (code: string) => void
  activePreset: QueryPreset | null
  dirty: boolean
  onSavePreset: (name: string) => void
  onUpdatePreset: () => void
}

// 后端 allowed_sort_fields + ai_sort_fields 对应的可排序列
const SORTABLE = new Set([
  'scale',
  'return_ytd',
  'drawdown_ytd',
  'sharpe_3y',
  'sharpe_1y',
  'max_drawdown_3y',
  'position_stock',
  // AI 定性分析（fund_ai_analysis）
  'skill_score',
  'rating',
])

const LUCK_OPTIONS = [
  { label: '实力', value: 'solid' },
  { label: '中性', value: 'mixed' },
  { label: '运气', value: 'luck' },
]
const CONC_OPTIONS = [
  { label: '单押', value: 'single_bet' },
  { label: '集中', value: 'focused' },
  { label: '分散', value: 'diversified' },
]

const MOBILE_SORT_OPTIONS = [
  { label: '默认排序', value: '' },
  ...([
    ['scale', '规模'],
    ['return_ytd', '今年收益'],
    ['drawdown_ytd', '今年回撤'],
    ['sharpe_3y', '夏普3年'],
    ['sharpe_1y', '夏普1年'],
    ['max_drawdown_3y', '最大回撤3年'],
    ['position_stock', '股票仓位'],
    ['skill_score', '实力分'],
    ['rating', 'AI评级'],
  ] as const).flatMap(([field, label]) => [
    { label: `${label}：高到低`, value: `${field}:desc` },
    { label: `${label}：低到高`, value: `${field}:asc` },
  ]),
]

const metric = (value: number | null | undefined, suffix = '') =>
  value == null ? '-' : `${num(value)}${suffix}`

function holdingSummary(fund: FundItem, type: 'stock' | 'bond') {
  const holdings = fund.holdings?.filter((holding) => holding.holding_type === type) ?? []
  if (!holdings.length) return '-'
  return holdings
    .map((holding) => `${holding.asset_name || holding.asset_code}${holding.hold_ratio == null ? '' : ` ${metric(holding.hold_ratio, '%')}`}`)
    .join('、')
}

function holdingLabel(fund: FundItem, type: 'stock' | 'bond') {
  const title = type === 'stock' ? '前十大股票持仓' : '前十大债券持仓'
  const quarter = fund.holdings?.find((holding) => holding.holding_type === type)?.quarter
  return quarter ? `${title}（${quarter} 披露）` : title
}

export default function FundQueryCard({
  funds,
  total,
  loading,
  page,
  pageSize,
  filters,
  fundTypes,
  onFiltersChange,
  onPageChange,
  onSortChange,
  onSearch,
  onReset,
  onOpenDetail,
  activePreset,
  dirty,
  onSavePreset,
  onUpdatePreset,
}: Props) {
  const { token } = theme.useToken()
  const sortable = (field: string) => (SORTABLE.has(field) ? true : undefined)
  const [trend, setTrend] = useState<{ code: string; name: string } | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [mobileSort, setMobileSort] = useState('')
  const advancedId = useId()
  const advancedCount = (filters.conditions?.length ?? 0) +
    (filters.luck_verdict?.length ?? 0) +
    (filters.concentration?.length ?? 0) +
    (filters.recommend ? 1 : 0) +
    (filters.exclude_codes?.length ?? 0) +
    (filters.name_excludes?.length ?? 0)
  const fundStyle = {
    '--fund-border': token.colorBorderSecondary,
    '--fund-muted': token.colorTextSecondary,
    '--fund-text': token.colorText,
    '--fund-accent': token.colorPrimary,
  } as CSSProperties

  const columns = buildFundColumns({
    sortable,
    onOpenDetail,
    onOpenTrend: (code, name) => setTrend({ code, name }),
    showNav: true,
    showAi: true,
  })

  const handleTableChange = (
    _pagination: unknown,
    _filters: unknown,
    sorter: SorterResult<FundItem> | SorterResult<FundItem>[],
  ) => {
    const arr = Array.isArray(sorter) ? sorter : [sorter]
    const sorters: SortInfo[] = arr
      .filter((s) => s.field && s.order)
      .map((s) => ({
        field: String(s.field),
        order: s.order === 'ascend' ? 'asc' : 'desc',
      }))
    setMobileSort(sorters.length ? `${sorters[0].field}:${sorters[0].order}` : '')
    onSortChange(sorters)
  }

  const setConditions = (conditions: CompareCondition[]) =>
    onFiltersChange({ ...filters, conditions })

  return (
    <Card title="基金筛选" size="small" className="fund-query-card" style={fundStyle}>
      <Space direction="vertical" className="w-full" style={{ width: '100%' }} size="middle">
        <div className="fund-query-basic">
          <Input
            aria-label="基金代码或名称关键字"
            className="fund-basic-keyword"
            placeholder="代码/名称关键字"
            value={filters.keyword}
            onChange={(e) => onFiltersChange({ ...filters, keyword: e.target.value })}
            onPressEnter={onSearch}
            allowClear
          />
          <Select
            aria-label="基金类型"
            className="fund-basic-type"
            mode="multiple"
            placeholder="基金类型"
            value={filters.fund_types}
            onChange={(v) => onFiltersChange({ ...filters, fund_types: v })}
            options={fundTypes.map((t) => ({ label: t.type_name, value: t.type_name }))}
            allowClear
          />
          <div className="fund-query-actions">
            <Button type="primary" onClick={onSearch} loading={loading}>查询</Button>
            <Button onClick={() => { setMobileSort(''); onReset() }}>清空</Button>
          </div>

          <span className="fund-query-divider" aria-hidden="true" />
          <div className="fund-query-preset-actions">
            {activePreset ? (
              <>
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  当前预设：{activePreset.name}
                  {dirty && <span style={{ marginLeft: 4, opacity: 0.7 }}>（已改动）</span>}
                </Tag>
                {dirty && (
                  <Button type="primary" ghost icon={<SaveOutlined />} onClick={onUpdatePreset}>
                    更新预设「{activePreset.name}」
                  </Button>
                )}
                <Button icon={<SaveOutlined />} onClick={() => setSaveOpen(true)}>
                  另存为新预设
                </Button>
              </>
            ) : (
              <Button icon={<SaveOutlined />} onClick={() => setSaveOpen(true)}>
                另存为预设
              </Button>
            )}
          </div>
        </div>

        <div className="fund-advanced">
          <div className="fund-advanced-title mb-2 text-sm font-medium text-gray-400">高级筛选（条件 / 排除）</div>
          <Button
            className="fund-advanced-toggle"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            aria-controls={advancedId}
            data-expanded={advancedOpen}
          >
            <span>高级筛选</span>
            <span className="fund-advanced-hint">{advancedCount ? `${advancedCount} 项已设置` : '条件、AI 与排除'}</span>
            <DownOutlined aria-hidden="true" />
          </Button>
          <div id={advancedId} className="fund-advanced-content" data-expanded={advancedOpen}>
            <Space direction="vertical" className="w-full" style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message="高级筛选基于基金详情数据。未拉取详情的基金不会出现在高级筛选结果中；若想为新基金补详情，请先用基础条件（类型/关键字）拉取详情，再用高级筛选。"
              />
              <MultiCompareFilter value={filters.conditions ?? []} onChange={setConditions} />
              <div className="fund-ai-filters">
                <span className="text-sm text-gray-400">AI 定性</span>
                <Select
                  aria-label="按运气或实力筛选"
                  className="fund-ai-select"
                  mode="multiple"
                  placeholder="运气/实力"
                  value={filters.luck_verdict}
                  onChange={(v) => onFiltersChange({ ...filters, luck_verdict: v })}
                  options={LUCK_OPTIONS}
                  allowClear
                />
                <Select
                  aria-label="按集中度筛选"
                  className="fund-ai-select"
                  mode="multiple"
                  placeholder="集中度"
                  value={filters.concentration}
                  onChange={(v) => onFiltersChange({ ...filters, concentration: v })}
                  options={CONC_OPTIONS}
                  allowClear
                />
                <Checkbox
                  checked={!!filters.recommend}
                  onChange={(e) => onFiltersChange({ ...filters, recommend: e.target.checked })}
                >
                  仅看推荐
                </Checkbox>
                <span className="text-xs text-gray-500">（选择 AI 条件即只显示已分析基金）</span>
              </div>
              <FundExcludeSelect
                codes={filters.exclude_codes ?? []}
                names={filters.name_excludes ?? []}
                onCodesChange={(v) => onFiltersChange({ ...filters, exclude_codes: v })}
                onNamesChange={(v) => onFiltersChange({ ...filters, name_excludes: v })}
              />
            </Space>
          </div>
        </div>

        <div className="fund-desktop-table">
          <Table<FundItem>
            rowKey="code"
            size="small"
            loading={loading}
            dataSource={funds}
            columns={columns}
            onChange={handleTableChange}
            scroll={{ x: 2360 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 只`,
              onChange: onPageChange,
            }}
          />
        </div>

        <div className="fund-mobile-results">
          <div className="fund-mobile-toolbar">
            <span className="fund-mobile-total">共 {total} 只基金</span>
            <Select
              aria-label="基金排序"
              value={mobileSort}
              options={MOBILE_SORT_OPTIONS}
              onChange={(value) => {
                setMobileSort(value)
                if (!value) onSortChange([])
                else {
                  const [field, order] = value.split(':')
                  onSortChange([{ field, order: order as SortInfo['order'] }])
                }
                onPageChange(1, pageSize)
              }}
            />
          </div>
          <Spin spinning={loading} tip="加载基金中">
            <div className="fund-mobile-list" aria-live="polite">
              {!loading && funds.length === 0 && <Empty description="没有符合条件的基金" />}
              {funds.map((fund) => (
                <article className="fund-mobile-item" key={fund.code}>
                  <div className="fund-mobile-head">
                    <button type="button" className="fund-mobile-name" onClick={() => onOpenDetail(fund.code)}>
                      {fund.name}
                    </button>
                    <span className="fund-mobile-code">{fund.code}</span>
                  </div>
                  <div className="fund-mobile-meta">
                    <span>{fund.type || fund.fund_type || '未分类'}</span>
                    <span>基金经理：{fund.fund_manager || fund.ai?.manager || '-'}</span>
                  </div>
                  <dl className="fund-mobile-metrics">
                    <div><dt>今年收益</dt><dd>{metric(fund.return_ytd, '%')}</dd></div>
                    <div><dt>今年回撤</dt><dd>{metric(fund.drawdown_ytd, '%')}</dd></div>
                    <div><dt>规模</dt><dd>{metric(fund.scale, ' 亿')}</dd></div>
                  </dl>
                  <details className="fund-mobile-more">
                    <summary>更多指标与 AI 分析</summary>
                    <dl className="fund-mobile-extra">
                      <div><dt>夏普3年</dt><dd>{metric(fund.sharpe_3y)}</dd></div>
                      <div><dt>夏普1年</dt><dd>{metric(fund.sharpe_1y)}</dd></div>
                      <div><dt>最大回撤3年</dt><dd>{metric(fund.max_drawdown_3y, '%')}</dd></div>
                      <div><dt>最大回撤1年</dt><dd>{metric(fund.max_drawdown_1y, '%')}</dd></div>
                      <div><dt>股票仓位</dt><dd>{metric(fund.position_stock, '%')}</dd></div>
                      <div><dt>债券仓位</dt><dd>{metric(fund.position_bond, '%')}</dd></div>
                      <div><dt>AI 评级</dt><dd>{fund.ai?.rating == null ? '-' : `${fund.ai.rating} 星`}</dd></div>
                      <div><dt>实力分</dt><dd>{fund.ai?.skill_score ?? '-'}</dd></div>
                      <div><dt>运气判断</dt><dd>{metaOf(LUCK_META, fund.ai?.luck_verdict)?.label ?? '-'}</dd></div>
                      <div><dt>集中度</dt><dd>{metaOf(CONC_META, fund.ai?.concentration)?.label ?? '-'}</dd></div>
                      <div><dt>基金属性</dt><dd>{metaOf(KIND_META, fund.ai?.fund_kind)?.label ?? '-'}</dd></div>
                      <div className="fund-mobile-wide"><dt>AI 结论</dt><dd>{fund.ai?.verdict || '-'}</dd></div>
                      <div className="fund-mobile-wide"><dt>{holdingLabel(fund, 'stock')}</dt><dd>{holdingSummary(fund, 'stock')}</dd></div>
                      <div className="fund-mobile-wide"><dt>{holdingLabel(fund, 'bond')}</dt><dd>{holdingSummary(fund, 'bond')}</dd></div>
                    </dl>
                  </details>
                  <div className="fund-mobile-item-actions">
                    <Button onClick={() => onOpenDetail(fund.code)}>查看详情</Button>
                    <Button onClick={() => setTrend({ code: fund.code, name: fund.name })}>净值走势</Button>
                  </div>
                </article>
              ))}
            </div>
          </Spin>
          {total > 0 && (
            <div className="fund-mobile-pagination">
              <Pagination
                simple
                current={page}
                pageSize={pageSize}
                total={total}
                onChange={onPageChange}
              />
              <Select
                aria-label="每页基金数量"
                value={pageSize}
                options={[10, 20, 50].map((value) => ({ value, label: `每页 ${value} 只` }))}
                onChange={(value) => onPageChange(1, value)}
              />
            </div>
          )}
        </div>
      </Space>

      <NavTrendModal
        code={trend?.code ?? null}
        name={trend?.name}
        open={!!trend}
        onClose={() => setTrend(null)}
      />
      <PresetNameModal
        open={saveOpen}
        title="另存为预设"
        onOk={(name) => {
          onSavePreset(name)
          setSaveOpen(false)
        }}
        onCancel={() => setSaveOpen(false)}
      />
    </Card>
  )
}
