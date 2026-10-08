import type { HTMLAttributes, ReactNode } from 'react';

/** Moldura de visor: quatro cantos, como as marcas de enquadramento de uma câmara. */
export function Frame({ children, className = '', ...rest }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`frame ${className}`} {...rest}>
      <span className="frame__corner" />
      <span className="frame__corner" />
      <span className="frame__corner" />
      <span className="frame__corner" />
      {children}
    </div>
  );
}
