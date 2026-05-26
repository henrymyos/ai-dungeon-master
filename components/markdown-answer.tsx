"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  text: string;
};

export function MarkdownAnswer({ text }: Props) {
  const components: Components = {
    h1: (props) => <h1 className="text-lg font-semibold mt-4 mb-2" {...props} />,
    h2: (props) => <h2 className="text-base font-semibold mt-4 mb-2" {...props} />,
    h3: (props) => <h3 className="text-sm font-semibold mt-3 mb-1.5" {...props} />,
    p: (props) => <p className="text-sm leading-relaxed my-2" {...props} />,
    ul: (props) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm" {...props} />,
    ol: (props) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm" {...props} />,
    li: (props) => <li className="leading-relaxed" {...props} />,
    strong: (props) => <strong className="font-semibold text-amber-200" {...props} />,
    em: (props) => <em className="italic text-amber-100/90" {...props} />,
    blockquote: (props) => (
      <blockquote
        className="border-l-2 border-[var(--accent)]/40 pl-3 my-2 text-zinc-300"
        {...props}
      />
    ),
  };

  return (
    <div className="text-zinc-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
