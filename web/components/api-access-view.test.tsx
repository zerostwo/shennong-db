import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiAccessView } from "./api-access-view";

vi.mock("next/dynamic",()=>({default:()=>()=> <div data-testid="chart"/>}));
vi.mock("@/lib/api/adapter",()=>({
  ShennongApiError:class extends Error{},
  getSession:async()=>({authenticated:true,user_id:"user-1",role:"user",scopes:[]}),
  listUserTokens:async()=>[],
  issueUserToken:async()=>({token:"sndb_once_only_secret",expires_at:1893456000})
}));

describe("ApiAccessView",()=>{
  it("creates a scoped token and displays the secret once",async()=>{
    render(<ApiAccessView/>);
    fireEvent.click(screen.getAllByRole("button",{name:"Create token"}).at(-1)!);
    fireEvent.change(screen.getByLabelText("Token name"),{target:{value:"CI pipeline"}});
    fireEvent.click(screen.getByLabelText("query.execute"));
    fireEvent.click(screen.getAllByRole("button",{name:"Create token"}).at(-1)!);
    await waitFor(()=>expect(screen.getByRole("heading",{name:"Token created"})).toBeInTheDocument());
    expect(screen.getByText("sndb_once_only_secret")).toBeInTheDocument();
  });
});
