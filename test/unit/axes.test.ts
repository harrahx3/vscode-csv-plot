import { describe, expect, it } from "vitest";
import { assignAxes, MAX_AXES, unitOf } from "../../src/webview/axes";

describe("unitOf", () => {
  it("reads the suffix after the last underscore, whatever it is", () => {
    expect(unitOf("q_demand_kw")?.key).toBe("kw");
    expect(unitOf("t_out_c")?.key).toBe("c");
    expect(unitOf("speed_furlongs")?.key).toBe("furlongs");
    expect(unitOf("Price_EUR")).toEqual({ key: "eur", label: "EUR" });
  });

  it("keeps compound units written with _per_", () => {
    expect(unitOf("mdot_kg_per_s")?.key).toBe("kg_per_s");
    expect(unitOf("energy_kwh_per_m2")?.key).toBe("kwh_per_m2");
  });

  it("reads units in trailing brackets", () => {
    expect(unitOf("Power [kW]")?.label).toBe("kW");
    expect(unitOf("Temp (°C)")?.label).toBe("°C");
  });

  it("returns null without a unit", () => {
    expect(unitOf("temperature")).toBeNull();
    expect(unitOf("sensor_2")).toBeNull();
    expect(unitOf("_hidden")).toBeNull();
    expect(unitOf("trailing_")).toBeNull();
  });
});

describe("assignAxes", () => {
  const s = (name: string, maxAbs = 1) => ({ name, maxAbs });

  it("groups columns sharing a unit", () => {
    const r = assignAxes([s("a_kw", 100), s("b_kw", 5), s("t_c", 70)]);
    expect(r.axes).toHaveLength(2);
    expect(r.axisOf).toEqual({ a_kw: 0, b_kw: 0, t_c: 1 });
    expect(r.axes[0].labels).toEqual(["kw"]);
  });

  it("is case-insensitive and labels with every spelling", () => {
    const r = assignAxes([s("a_kW"), s("b_kw")]);
    expect(r.axes).toHaveLength(1);
    expect(r.axes[0].labels).toEqual(["kW", "kw"]);
  });

  it("groups unit-less columns by order of magnitude", () => {
    const r = assignAxes([s("alpha", 100), s("beta", 300), s("gamma", 50000)]);
    expect(r.axisOf).toEqual({ alpha: 0, beta: 0, gamma: 1 });
  });

  it("never creates more than the maximum number of axes", () => {
    const r = assignAxes([
      s("a_u1", 1),
      s("b_u2", 10),
      s("c_u3", 100),
      s("d_u4", 1000),
      s("e_u5", 900),
    ]);
    expect(r.axes).toHaveLength(MAX_AXES);
    expect(r.axisOf.e_u5).toBe(3);
  });

  it("applies manual overrides, including a new axis", () => {
    const r = assignAxes([s("a_kw"), s("b_kw"), s("t_c")], { b_kw: 2 });
    expect(r.axisOf).toEqual({ a_kw: 0, t_c: 1, b_kw: 1 });
    const r2 = assignAxes([s("a_kw"), s("b_kw")], { b_kw: 5 });
    expect(r2.axes).toHaveLength(2);
    expect(r2.axisOf.b_kw).toBe(1);
  });
});
