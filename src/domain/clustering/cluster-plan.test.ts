import { describe, expect, it } from "vitest";
import { ClusterPlanInvariantError, validateClusterPlan } from "./cluster-plan";
const a="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222", c="33333333-3333-4333-8333-333333333333";
const valid={clusters:[{name:"Node 错误响应兼容性",summary:"客户端错误对象结构不一致。",suggestedAction:"product",memberRunIssueIds:[a,b]}],unclusteredRunIssueIds:[c]};
describe("validateClusterPlan",()=>{
  it("accepts exact, disjoint coverage",()=>expect(validateClusterPlan(valid,[a,b,c])).toEqual(valid));
  it("rejects invented members",()=>expect(()=>validateClusterPlan({...valid,unclusteredRunIssueIds:["44444444-4444-4444-8444-444444444444"]},[a,b,c])).toThrowError(new ClusterPlanInvariantError("UNKNOWN_MEMBER")));
  it("rejects duplicate assignment",()=>expect(()=>validateClusterPlan({...valid,unclusteredRunIssueIds:[b,c]},[a,b,c])).toThrowError(new ClusterPlanInvariantError("DUPLICATE_MEMBER")));
  it("rejects missing members",()=>expect(()=>validateClusterPlan({...valid,unclusteredRunIssueIds:[]},[a,b,c])).toThrowError(new ClusterPlanInvariantError("INCOMPLETE_COVERAGE")));
  it("does not allow singleton clusters",()=>expect(()=>validateClusterPlan({clusters:[{...valid.clusters[0],memberRunIssueIds:[a]}],unclusteredRunIssueIds:[b,c]},[a,b,c])).toThrow());
});
