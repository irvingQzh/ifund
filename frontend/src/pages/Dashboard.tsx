import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Button, Drawer, Grid, Layout, Menu } from 'antd'
import {
  ApartmentOutlined,
  CalendarOutlined,
  CloseOutlined,
  DeploymentUnitOutlined,
  FundOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { FundPage } from './fund'
import WorkbenchPage from './workbench/WorkbenchPage'
import HoldingsPage from './reconcile/HoldingsPage'
import IndustryPage from './IndustryPage'
import TokensPage from './TokensPage'
import TradeCalendar from './TradeCalendar'
import { AUTH_TOKEN_KEY } from '../config'

const { Header, Sider, Content } = Layout
const menuItems = [
  { key: 'fund', icon: <FundOutlined />, label: '基金管理' },
  { key: 'workbench', icon: <DeploymentUnitOutlined />, label: '组合分析' },
  { key: 'holdings', icon: <WalletOutlined />, label: '实盘' },
  { key: 'trade_calendar', icon: <CalendarOutlined />, label: '交易日历' },
  { key: 'industry', icon: <ApartmentOutlined />, label: '行业映射' },
  { key: 'tokens', icon: <KeyOutlined />, label: '访问令牌' },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const selected = location.pathname.split('/')[1] || 'fund'
  const screens = Grid.useBreakpoint()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (screens.lg) setMobileMenuOpen(false)
  }, [screens.lg])

  const logout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    navigate('/login')
  }

  const go = (key: string) => {
    setMobileMenuOpen(false)
    navigate(key === 'fund' ? '/' : `/${key}`)
  }

  return (
    // 固定视口高度：仅内容区滚动，Header/侧边栏不随滚动移动
    <Layout className="qfund-shell">
      <a className="qfund-skip-link" href="#qfund-main">跳转到主内容</a>
      <Header className="qfund-header flex items-center justify-between">
        <div className="qfund-header-brand">
          <Button
            className="qfund-mobile-menu-button"
            type="text"
            icon={<MenuOutlined />}
            aria-label="打开导航菜单"
            aria-expanded={mobileMenuOpen && !screens.lg}
            onClick={() => setMobileMenuOpen(true)}
          />
          <span className="qfund-brand-name">Qfund</span>
        </div>
        <Button icon={<LogoutOutlined />} onClick={logout} ghost className="qfund-logout-button">
          退出
        </Button>
      </Header>
      <Layout className="qfund-main-layout">
        <Sider
          className="qfund-desktop-sider"
          width={160}
          theme="dark"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
        >
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[selected]}
            onClick={(e) => go(e.key)}
            items={menuItems}
          />
        </Sider>
        <Content id="qfund-main" tabIndex={-1} className="qfund-content">
          <Routes>
            <Route path="/" element={<FundPage />} />
            <Route path="/workbench" element={<WorkbenchPage />} />
            <Route path="/holdings" element={<HoldingsPage />} />
            <Route path="/trade_calendar" element={<TradeCalendar />} />
            <Route path="/industry" element={<IndustryPage />} />
            <Route path="/tokens" element={<TokensPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
      <Drawer
        open={mobileMenuOpen && !screens.lg}
        onClose={() => setMobileMenuOpen(false)}
        placement="left"
        width={264}
        title={<span style={{ color: '#fff' }}>Qfund 导航</span>}
        closeIcon={<CloseOutlined style={{ color: '#fff' }} />}
        styles={{
          header: { background: '#001529', borderBottom: '1px solid rgba(255,255,255,0.12)' },
          body: { padding: 0, background: '#001529' },
        }}
      >
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[selected]}
          onClick={(e) => go(e.key)}
          items={menuItems}
        />
      </Drawer>
    </Layout>
  )
}
