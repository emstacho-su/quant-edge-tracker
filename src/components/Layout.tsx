import { Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Header } from '@/components/ui/header-2'
import NeuralBackground from '@/components/ui/flow-field-background'
import GlitterBackground from '@/components/ui/glitter-background'
import { useBgConfig } from '@/lib/bg-config'
import { useViewport } from '@/hooks/useViewport'
import { useDemoMode } from '@/lib/demo-mode'

function Layout() {
  const { style, mobileEnabled } = useBgConfig()
  const { isMobile } = useViewport()
  const showBackground = !isMobile || mobileEnabled
  // Subscribe at the top so toggling demo mode re-renders the whole tree.
  useDemoMode()

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      {showBackground && (
        <div className="pointer-events-none fixed inset-0 z-0">
          {style === 'glitter' ? (
            <GlitterBackground />
          ) : (
            <NeuralBackground
              trailOpacity={0.06}
              particleCount={200}
              scale={1.5}
            />
          )}
        </div>
      )}

      <Header />

      <main className="relative z-10 flex-1 overflow-x-hidden px-4 py-6 md:px-6 md:py-8 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="mx-auto w-full max-w-7xl"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  )
}

export default Layout
