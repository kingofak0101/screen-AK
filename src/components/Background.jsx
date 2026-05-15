export default function Background() {
  return (
    <>
      <div className="fixed -top-48 -left-48 w-[520px] h-[520px] rounded-full bg-accent2/[0.15] blur-3xl pointer-events-none animate-blob-1 z-0" />
      <div className="fixed -bottom-40 -right-40 w-[420px] h-[420px] rounded-full bg-accent/[0.12] blur-3xl pointer-events-none animate-blob-2 z-0" />
      <div className="fixed top-[40%] left-[55%] w-[260px] h-[260px] rounded-full bg-accent3/[0.08] blur-3xl pointer-events-none z-0" />
    </>
  );
}
