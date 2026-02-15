import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// HTML 문서에서 React 앱이 마운트될 루트 요소('root')를 찾습니다.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// React Root를 생성하고 App 컴포넌트를 렌더링합니다.
// StrictMode는 개발 모드에서 잠재적인 문제를 감지하기 위해 사용됩니다.
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
