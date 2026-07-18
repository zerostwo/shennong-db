import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMarkdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`chat-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href = "", children: linkChildren, ...props }) => {
            const external = /^https?:\/\//i.test(href);
            return <a {...props} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>{linkChildren}</a>;
          },
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
