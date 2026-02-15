import React from 'react';

// 버튼에 사용할 props 타입 정의
// 기본 button 속성 + variant 옵션 추가
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon'; // 버튼 종류
}

// 공통 버튼 컴포넌트
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',   // 기본 버튼 타입
  className = '',        // 추가 커스텀 클래스
  children,              // 버튼 안 내용
  ...props               // onClick, disabled 등 기본 속성
}) => {

  // 모든 버튼에 공통으로 적용되는 기본 스타일
  const baseStyle =
    "transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed font-bold tracking-wider";
  
  // 기본(primary) 버튼 스타일
  const primaryStyle = `
    bg-gradient-to-b from-[#6D1A1A] to-[#3E0E0E] 
    border-2 border-[#CUA656] hover:border-[#F2D086]
    text-[#F2D086] hover:text-white
    shadow-[0_4px_0_#2A0A0A] hover:shadow-[0_6px_0_#2A0A0A] active:shadow-none active:translate-y-1
    px-8 py-3 rounded-sm text-lg
  `;

  // 보조(secondary) 버튼 스타일
  const secondaryStyle = `
    bg-[#2c1e16] bg-opacity-80
    border border-[#8B4513] hover:border-[#CUA656]
    text-[#D2B48C] hover:text-white
    px-4 py-2 rounded-sm
  `;

  // 아이콘 전용 버튼 스타일
  const iconStyle = `
    p-2 rounded-full hover:bg-white/10 text-[#F2D086] transition-colors
  `;

  // variant 값에 따라 스타일 매핑
  const styles = {
    primary: primaryStyle,
    secondary: secondaryStyle,
    icon: iconStyle,
  };

  return (
    <button
      // 공통 스타일 + variant 스타일 + 사용자 스타일 합침
      className={`${baseStyle} ${styles[variant]} ${className}`}
      {...props} // 클릭, 비활성화 등 기본 속성 전달
    >
      {children}
    </button>
  );
};
