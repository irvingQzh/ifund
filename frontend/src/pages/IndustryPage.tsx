import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd'
import { EditOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import request from '../api/request'
import './utilities-mobile.css'

interface IndustryRow {
  stock_code: string
  stock_name: string
  market: string
  sw_l1?: string
  sw_l2?: string
  sw_l3?: string
  em_industry?: string
  source?: string
  manual?: number
  label: string
  covered: boolean
}

interface Stats {
  held_total: number
  a_total: number
  hk_total: number
  other_total: number
  a_sw_covered: number
  a_em_covered: number
  a_uncovered: number
  hk_covered: number
  hk_uncovered: number
  covered_total: number
  coverage_pct: number
  a_sw_pct: number
  sw_l3_count: number
  table_rows: number
}

interface RunningTask {
  id: number
  status: string
  target_count: number
  current_count: number
  success_count: number
  fail_count: number
  executor_ip: string
}

interface BreakdownItem {
  label: string
  count: number
  sw_l1: string
}

const MARKET_LABEL: Record<string, string> = { A: 'A股', HK: '港股', OTHER: '海外' }

export default function IndustryPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [breakdown, setBreakdown] = useState<BreakdownItem[]>([])
  const [rows, setRows] = useState<IndustryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [market, setMarket] = useState('')
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [swTask, setSwTask] = useState<RunningTask | null>(null)
  const [emTask, setEmTask] = useState<RunningTask | null>(null)
  const [editing, setEditing] = useState<IndustryRow | null>(null)
  const [form] = Form.useForm()
  const timer = useRef<number | null>(null)

  const loadStats = useCallback(async () => {
    const [s, b] = await Promise.all([
      request.get<Stats>('/stock_industry/stats'),
      request.get<BreakdownItem[]>('/stock_industry/breakdown', { params: { top: 0 } }),
    ])
    setStats(s.data)
    setBreakdown(b.data)
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await request.get('/stock_industry/list', {
        params: { page, page_size: pageSize, market, status, keyword },
      })
      setRows(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, market, status, keyword])

  const pollTasks = useCallback(async () => {
    const [sw, em] = await Promise.all([
      request.get<RunningTask>('/stock_industry/task/running', { params: { type: 'sw' } }),
      request.get<RunningTask>('/stock_industry/task/running', { params: { type: 'em' } }),
    ])
    setSwTask(sw.data || null)
    setEmTask(em.data || null)
    return Boolean(sw.data) || Boolean(em.data)
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])
  useEffect(() => {
    loadList()
  }, [loadList])

  // 有运行中任务时轮询进度，结束后刷新统计/列表
  useEffect(() => {
    const tick = async () => {
      const running = await pollTasks()
      if (!running && timer.current) {
        window.clearInterval(timer.current)
        timer.current = null
        loadStats()
        loadList()
      }
    }
    tick()
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ensurePolling = () => {
    if (!timer.current) {
      timer.current = window.setInterval(pollTasks, 2000)
    }
  }

  const startTask = async (kind: 'sw' | 'em') => {
    try {
      await request.post(`/stock_industry/sync/${kind}`)
      message.success(kind === 'sw' ? '已启动申万采集' : '已启动东财兜底')
      ensurePolling()
      pollTasks()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '启动失败')
    }
  }

  const terminate = async (taskId: number) => {
    await request.post(`/stock_industry/task/${taskId}/terminate`)
    message.info('已请求终止')
    pollTasks()
  }

  const openEdit = (row: IndustryRow) => {
    setEditing(row)
    form.setFieldsValue({
      market: row.market,
      sw_l1: row.sw_l1,
      sw_l2: row.sw_l2,
      sw_l3: row.sw_l3,
      em_industry: row.em_industry,
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    const values = await form.validateFields()
    await request.put(`/stock_industry/manual/${editing.stock_code}`, values)
    message.success('已保存人工修正')
    setEditing(null)
    loadStats()
    loadList()
  }

  const columns: ColumnsType<IndustryRow> = [
    { title: '代码', dataIndex: 'stock_code', width: 90 },
    { title: '名称', dataIndex: 'stock_name', width: 110 },
    {
      title: '市场',
      dataIndex: 'market',
      width: 70,
      render: (m: string) => <Tag>{MARKET_LABEL[m] || m}</Tag>,
    },
    { title: '申万一级', dataIndex: 'sw_l1', width: 110, render: (v) => v || '-' },
    { title: '申万二级', dataIndex: 'sw_l2', width: 120, render: (v) => v || '-' },
    {
      title: '申万三级',
      dataIndex: 'sw_l3',
      width: 130,
      render: (v) => (v ? <Tag color="blue">{v}</Tag> : '-'),
    },
    {
      title: '东财行业',
      dataIndex: 'em_industry',
      width: 120,
      render: (v) => (v ? <Tag color="gold">{v}</Tag> : '-'),
    },
    {
      title: '状态',
      dataIndex: 'covered',
      width: 90,
      render: (c: boolean, r) =>
        c ? (
          <Tag color="green">{r.manual ? '人工' : '已覆盖'}</Tag>
        ) : (
          <Tag color="red">未覆盖</Tag>
        ),
    },
    {
      title: '操作',
      width: 70,
      render: (_, r) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
          修正
        </Button>
      ),
    },
  ]

  const swRunning = swTask?.status === 'running'
  const emRunning = emTask?.status === 'running'

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }} className="qfund-industry-page">
      <Row gutter={[12, 12]} className="qfund-industry-summary">
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic title="持仓股票总数" value={stats?.held_total ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic
              title="总覆盖率"
              value={stats?.coverage_pct ?? 0}
              suffix="%"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic
              title={`A股申万覆盖 (${stats?.a_sw_pct ?? 0}%)`}
              value={stats?.a_sw_covered ?? 0}
              suffix={`/ ${stats?.a_total ?? 0}`}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic
              title="港股已覆盖"
              value={stats?.hk_covered ?? 0}
              suffix={`/ ${stats?.hk_total ?? 0}`}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic
              title="未覆盖"
              value={(stats?.a_uncovered ?? 0) + (stats?.hk_uncovered ?? 0)}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card size="small">
            <Statistic title="申万三级数 / 表行数" value={stats?.sw_l3_count ?? 0} suffix={`/ ${stats?.table_rows ?? 0}`} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} className="qfund-industry-tasks">
        <Col xs={24} lg={12}>
          <Card
            className="qfund-industry-task-card"
            size="small"
            title="① 申万三级采集（legulegu，主标签）"
            extra={
              <Space>
                <Tooltip title="遍历 336 个申万三级行业，已采行业自动跳过（可分批多次点）">
                  <Button type="primary" size="small" disabled={swRunning} onClick={() => startTask('sw')}>
                    开始 / 续采
                  </Button>
                </Tooltip>
                {swRunning && (
                  <Button danger size="small" onClick={() => terminate(swTask!.id)}>
                    终止
                  </Button>
                )}
              </Space>
            }
          >
            <p className="qfund-industry-task-help">采集申万三级行业；已采行业自动跳过，可分批续采。</p>
            {swTask ? (
              <>
                <Progress
                  percent={
                    swTask.target_count
                      ? Math.round((swTask.current_count / swTask.target_count) * 100)
                      : 0
                  }
                  status={swRunning ? 'active' : 'normal'}
                />
                <Space wrap size="small">
                  <Tag color={swRunning ? 'processing' : 'default'}>{swTask.status}</Tag>
                  <span>
                    {swTask.current_count}/{swTask.target_count} 行业
                  </span>
                  <Tag color="green">成功 {swTask.success_count}</Tag>
                  <Tag color="red">失败 {swTask.fail_count}</Tag>
                </Space>
              </>
            ) : (
              <span style={{ color: '#999' }}>无进行中的任务</span>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            className="qfund-industry-task-card"
            size="small"
            title="② 东财兜底（港股）"
            extra={
              <Space>
                <Tooltip title="补未覆盖港股的行业(东财港股资料)；并用A股全集把误判成A股的韩股/退市票改判海外。北交所/特钢等A股缺口请用人工修正。需直连东财环境运行">
                  <Button type="primary" size="small" disabled={emRunning} onClick={() => startTask('em')}>
                    校正+补港股
                  </Button>
                </Tooltip>
                {emRunning && (
                  <Button danger size="small" onClick={() => terminate(emTask!.id)}>
                    终止
                  </Button>
                )}
              </Space>
            }
          >
            <p className="qfund-industry-task-help">补全港股行业并校正误判市场；此任务需可直连东财。</p>
            {emTask ? (
              <>
                <Progress
                  percent={
                    emTask.target_count
                      ? Math.round((emTask.current_count / emTask.target_count) * 100)
                      : 0
                  }
                  status={emRunning ? 'active' : 'normal'}
                />
                <Space wrap size="small">
                  <Tag color={emRunning ? 'processing' : 'default'}>{emTask.status}</Tag>
                  <span>
                    {emTask.current_count}/{emTask.target_count} 只
                  </span>
                  <Tag color="green">成功 {emTask.success_count}</Tag>
                  <Tag color="red">失败 {emTask.fail_count}</Tag>
                </Space>
              </>
            ) : (
              <span style={{ color: '#999' }}>无进行中的任务</span>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        className="qfund-industry-breakdown"
        size="small"
        title={`行业分布（持仓标的数，按聚类标签全量，共 ${
          breakdown.filter((b) => b.label !== '未覆盖').length
        } 个行业，用于直观分析聚类粒度）`}
      >
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <Space wrap size={[8, 8]}>
            {breakdown.length === 0 && <span style={{ color: '#999' }}>暂无数据，先执行采集</span>}
            {breakdown.map((b) => (
              <Tag key={b.label} color={b.label === '未覆盖' ? 'red' : 'blue'}>
                {b.label} · {b.count}
              </Tag>
            ))}
          </Space>
        </div>
      </Card>

      <Card
        className="qfund-industry-map"
        size="small"
        title="股票 → 行业映射"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => { loadStats(); loadList() }}>
            刷新
          </Button>
        }
      >
        <div className="qfund-industry-filters">
          <Select
            aria-label="筛选市场"
            value={market}
            onChange={(v) => { setMarket(v); setPage(1) }}
            options={[
              { value: '', label: '全部市场' },
              { value: 'A', label: 'A股' },
              { value: 'HK', label: '港股' },
              { value: 'OTHER', label: '海外' },
            ]}
          />
          <Select
            aria-label="筛选覆盖状态"
            value={status}
            onChange={(v) => { setStatus(v); setPage(1) }}
            options={[
              { value: '', label: '全部状态' },
              { value: 'covered', label: '已覆盖' },
              { value: 'uncovered', label: '未覆盖' },
            ]}
          />
          <Input.Search
            aria-label="搜索股票代码或名称"
            placeholder="代码 / 名称"
            allowClear
            onSearch={(v) => { setKeyword(v); setPage(1) }}
          />
        </div>
        <div className="qfund-industry-mobile-view">
          <Spin spinning={loading}>
            <div className="qfund-industry-mobile-list">
              {rows.length === 0 && !loading ? <Empty description="暂无匹配的股票" /> : rows.map((row) => (
                <article key={row.stock_code} className="qfund-industry-mobile-row">
                  <div className="qfund-industry-mobile-row-head">
                    <div>
                      <strong>{row.stock_name}</strong>
                      <code>{row.stock_code}</code>
                    </div>
                    <div className="qfund-industry-mobile-tags">
                      <Tag>{MARKET_LABEL[row.market] || row.market}</Tag>
                      <Tag color={row.covered ? 'green' : 'red'}>
                        {row.covered ? (row.manual ? '人工' : '已覆盖') : '未覆盖'}
                      </Tag>
                    </div>
                  </div>
                  <dl className="qfund-industry-mobile-fields">
                    <div><dt>聚类标签</dt><dd>{row.label || '—'}</dd></div>
                    <div><dt>申万一级</dt><dd>{row.sw_l1 || '—'}</dd></div>
                  </dl>
                  <details className="qfund-industry-mobile-details">
                    <summary>查看完整分类</summary>
                    <dl className="qfund-industry-mobile-fields">
                      <div><dt>申万二级</dt><dd>{row.sw_l2 || '—'}</dd></div>
                      <div><dt>申万三级</dt><dd>{row.sw_l3 || '—'}</dd></div>
                      <div><dt>东财行业</dt><dd>{row.em_industry || '—'}</dd></div>
                    </dl>
                  </details>
                  <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>人工修正</Button>
                </article>
              ))}
            </div>
          </Spin>
        </div>
        {total > pageSize && (
          <Pagination
            className="qfund-industry-mobile-pagination"
            simple
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={(p) => setPage(p)}
          />
        )}
        <Table<IndustryRow>
          className="qfund-industry-desktop-table"
          rowKey="stock_code"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 只`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) },
          }}
        />
      </Card>

      <Modal
        className="qfund-industry-edit-modal"
        open={!!editing}
        title={`人工修正 · ${editing?.stock_code} ${editing?.stock_name}`}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="market" label="市场">
            <Select
              options={[
                { value: 'A', label: 'A股' },
                { value: 'HK', label: '港股' },
                { value: 'OTHER', label: '海外' },
              ]}
            />
          </Form.Item>
          <Form.Item name="sw_l1" label="申万一级">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="sw_l2" label="申万二级">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="sw_l3" label="申万三级（主标签）">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="em_industry" label="东财行业（兜底）">
            <Input allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
