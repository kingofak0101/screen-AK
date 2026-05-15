import { motion, AnimatePresence } from 'framer-motion';

export default function Toast({ message, type = 'success', show }) {
  const isError = type === 'error';
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 20, x: '-50%' }}
          transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
          className={`fixed bottom-7 left-1/2 z-[100] px-6 py-3.5 rounded-xl text-[13px] font-medium whitespace-nowrap shadow-2xl bg-[rgba(8,10,20,0.96)] border ${
            isError
              ? 'border-red-500/35 text-red-300'
              : 'border-accent/30 text-accent'
          }`}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
