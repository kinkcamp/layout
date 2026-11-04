import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#65aaa3',
          colorInfo: '#65aaa3',
          colorBgBase: '#101619',
          colorBgContainer: '#171e22',
          colorBgElevated: '#1d272c',
          colorBorder: '#334147',
          colorBorderSecondary: '#273238',
          colorText: '#dce5e5',
          colorTextSecondary: '#91a1a5',
          borderRadius: 4,
          fontSize: 12,
          controlHeight: 28,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Button: { controlHeight: 28 },
          Table: { headerBg: '#1b2428', rowHoverBg: '#202d31', cellPaddingBlockSM: 8 },
          Tree: { directoryNodeSelectedBg: '#25383a' },
          Drawer: { paddingLG: 16 },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
