// No "use client": the share page renders this on the server (no react-markdown
// JS shipped there); dm-chat, a client component, still bundles it client-side.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Hoisted so the components map is referentially stable across renders.
// Otherwise react-markdown sees a fresh prop on every parent render and
// remounts the entire markdown subtree — which (a) makes every paragraph
// re-fire the fade-in CSS animation on each keystroke, and (b) is wasted
// reconciliation work.
const REMARK_PLUGINS = [remarkGfm];
/* eslint-disable @typescript-eslint/no-unused-vars -- `node` (the mdast node) is destructured out so it never lands in the DOM as node="[object Object]" */
const COMPONENTS: Components = {
  h1: ({ node: _node, ...props }) => <h1 className="text-lg font-semibold mt-4 mb-2" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="text-base font-semibold mt-4 mb-2" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="text-sm font-semibold mt-3 mb-1.5" {...props} />,
  p: ({ node: _node, ...props }) => <p className="text-sm leading-relaxed my-2" {...props} />,
  ul: ({ node: _node, ...props }) => (
    <ul className="list-disc pl-5 my-2 space-y-1 text-sm" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="list-decimal pl-5 my-2 space-y-1 text-sm" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="leading-relaxed" {...props} />,
  strong: ({ node: _node, ...props }) => (
    <strong className="font-semibold text-amber-200" {...props} />
  ),
  em: ({ node: _node, ...props }) => <em className="italic text-amber-100/90" {...props} />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-[var(--accent)]/40 pl-3 my-2 text-zinc-300"
      {...props}
    />
  ),
};

/* eslint-enable @typescript-eslint/no-unused-vars */

type Props = {
  text: string;
};

export function MarkdownAnswer({ text }: Props) {
  return (
    <div className="text-zinc-100 narration">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
