import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Form, Input, Tabs, message } from 'antd'
import request from '../api/request'
import { ALLOW_REGISTRATION, AUTH_TOKEN_KEY } from '../config'
import './utilities-mobile.css'

interface FormValues {
  username: string
  password: string
}

export default function Login() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')

  const onFinish = async (values: FormValues) => {
    setLoading(true)
    try {
      if (ALLOW_REGISTRATION && mode === 'register') {
        await request.post('/auth/register', values)
        message.success('注册成功，请登录')
        setMode('login')
        return
      }
      const { data } = await request.post('/auth/login', values)
      localStorage.setItem(AUTH_TOKEN_KEY, data.access_token)
      message.success('登录成功')
      navigate('/')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string; error?: string } } }).response?.data
          ?.detail ?? '操作失败，请检查用户名密码'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="qfund-login-screen">
      <Card className="qfund-login-card" title="Qfund">
        {ALLOW_REGISTRATION && (
          <Tabs
            activeKey={mode}
            onChange={(k) => setMode(k as 'login' | 'register')}
            items={[
              { key: 'login', label: '登录' },
              { key: 'register', label: '注册' },
            ]}
          />
        )}
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            {mode === 'login' ? '登录' : '注册'}
          </Button>
        </Form>
      </Card>
    </main>
  )
}
