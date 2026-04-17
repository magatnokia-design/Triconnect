function Logo({ size = 'md' }) {
  const sizes = {
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-5xl'
  }

  return (
    <div className="flex items-center gap-2">
      <div className="bg-gradient-to-br from-primary to-primary-dark rounded-lg p-2 shadow-md">
        <svg className={`${sizes[size]} text-white`} width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M16 4L4 10L16 16L28 10L16 4Z" fill="currentColor"/>
          <path d="M4 16L16 22L28 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M4 22L16 28L28 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div>
        <h1 className={`${sizes[size]} font-bold bg-gradient-to-r from-primary to-primary-dark bg-clip-text text-transparent`}>
          TriConnect
        </h1>
        <p className="text-xs text-gray-500 -mt-1">PSU Learning Hub</p>
      </div>
    </div>
  )
}

export default Logo