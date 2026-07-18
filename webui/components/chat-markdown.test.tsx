import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./chat-markdown";

describe("ChatMarkdown", () => {
  it("renders safe GFM, code, tables, and external links", () => {
    const { container } = render(<ChatMarkdown>{`## Result

| Gene | Change |
| --- | --- |
| YTHDF2 | **Up** |

Use \`query_expression\`.

\`\`\`r
plot(expression)
\`\`\`

[Source](https://example.org/data)

![remote chart](https://tracker.example/chart.png)

<script>alert("unsafe")</script>`}</ChatMarkdown>);
    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("YTHDF2");
    expect(screen.getByText("query_expression").tagName).toBe("CODE");
    expect(screen.getByText("plot(expression)").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "Source" })).toMatchObject({ target: "_blank", rel: "noreferrer noopener" });
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("unsafe");
  });
});
