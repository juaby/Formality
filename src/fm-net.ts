// ~~ Formality Interaction Net System ~~
// TODO: remove num-ops and pairs

// PtrNum types
enum PortType {
  PTR,
  NUM
}

// Node types
enum NodeType {
  NOD,
  OP1,
  OP2,
  ITE
}

// Base types
// TODO: Specify each port on type level to have more type safety and enforce port type checks
interface Port {
  typ: PortType;
  val: number;
}

const Pointer = (addr: number, port: number): Port => ({
  typ: PortType.PTR,
  val: (addr << 2) + (port & 3)
});
const addr_of = (ptrn: Port): number => ptrn.val >>> 2;
const slot_of = (ptrn: Port): number => ptrn.val & 3;

const Numeric = (numb: number): Port => ({ typ: PortType.NUM, val: numb });
const numb_of = (ptrn: Port): number => ptrn.val;
const type_of = (ptrn: Port): PortType => ptrn.typ;
const ptrn_eq = (a: Port, b: Port): boolean =>
  a.typ === b.typ && a.val === b.val;
const ptrn_st = (a: Port): string => a.typ + ":" + a.val;

interface Stats {
  loop: number;
  rwts: number;
  mlen: number;
}

const init_stats = (fields?: Partial<Stats>): Stats => ({
  loop: 0,
  rwts: 0,
  mlen: 0,
  ...fields
});

class Net {
  // TODO: Add better typings
  nodes: any[];
  freed: any[];
  redex: any[];
  find_redex: boolean;
  // A net stores nodes (this.nodes), reclaimable memory addrs (this.freed) and active pairs (this.redex)
  constructor() {
    this.nodes = []; // nodes
    this.freed = []; // integers
    this.redex = []; // array of (integer, integer) tuples representing addrs
    this.find_redex = true;
  }

  // Allocates a new node, return its addr
  alloc_node(type, kind) {
    var addr: number;
    // If there is reclaimable memory, use it
    if (this.freed.length > 0) {
      addr = this.freed.pop();

      // Otherwise, extend the array of nodes
    } else {
      addr = this.nodes.length / 4;
    }

    // Fill the memory with an empty node without pointers
    this.nodes[addr * 4 + 0] = addr * 4 + 0;
    this.nodes[addr * 4 + 1] = addr * 4 + 1;
    this.nodes[addr * 4 + 2] = addr * 4 + 2;
    this.nodes[addr * 4 + 3] = (kind << 6) + ((type & 0x7) << 3);
    return addr;
  }

  // Deallocates a node, allowing its space to be reclaimed
  free_node(addr) {
    this.nodes[addr * 4 + 0] = addr * 4 + 0;
    this.nodes[addr * 4 + 1] = addr * 4 + 1;
    this.nodes[addr * 4 + 2] = addr * 4 + 2;
    this.nodes[addr * 4 + 3] = 0;
    this.freed.push(addr);
  }

  is_free(addr) {
    return (
      this.nodes[addr * 4 + 0] === addr * 4 + 0 &&
      this.nodes[addr * 4 + 1] === addr * 4 + 1 &&
      this.nodes[addr * 4 + 2] === addr * 4 + 2 &&
      this.nodes[addr * 4 + 3] === 0
    );
  }

  // Returns if given slot holds a number
  is_numeric(addr, slot) {
    return (this.nodes[addr * 4 + 3] >>> slot) & 1;
  }

  set_port(addr, slot, ptrn) {
    if (type_of(ptrn) === PortType.NUM) {
      this.nodes[addr * 4 + slot] = numb_of(ptrn);
      this.nodes[addr * 4 + 3] = this.nodes[addr * 4 + 3] | (1 << slot);
    } else {
      this.nodes[addr * 4 + slot] = (addr_of(ptrn) << 2) + (slot_of(ptrn) & 3);
      this.nodes[addr * 4 + 3] = this.nodes[addr * 4 + 3] & ~(1 << slot);
    }
  }

  get_port(addr, slot) {
    var val = this.nodes[addr * 4 + slot];
    return !this.is_numeric(addr, slot)
      ? Pointer(val >>> 2, val & 3)
      : Numeric(val);
  }

  type_of(addr) {
    return (this.nodes[addr * 4 + 3] >>> 3) & 0x7;
  }

  set_type(addr, type) {
    this.nodes[addr * 4 + 3] =
      (this.nodes[addr * 4 + 3] & ~0b111000) | (type << 3);
  }

  kind_of(addr) {
    return this.nodes[addr * 4 + 3] >>> 6;
  }

  // Given a pointer to a port, returns a pointer to the opposing port
  enter_port(ptrn) {
    if (type_of(ptrn) === PortType.NUM) {
      throw "Can't enter a numeric pointer.";
    } else {
      return this.get_port(addr_of(ptrn), slot_of(ptrn));
    }
  }

  // Connects two ports
  link_ports(a_ptrn, b_ptrn) {
    var a_numb = type_of(a_ptrn) === PortType.NUM;
    var b_numb = type_of(b_ptrn) === PortType.NUM;

    // Point ports to each-other
    if (!a_numb) this.set_port(addr_of(a_ptrn), slot_of(a_ptrn), b_ptrn);
    if (!b_numb) this.set_port(addr_of(b_ptrn), slot_of(b_ptrn), a_ptrn);

    // If both are main ports, add this to the list of active pairs
    if (
      this.find_redex &&
      !(a_numb && b_numb) &&
      (a_numb || slot_of(a_ptrn) === 0) &&
      (b_numb || slot_of(b_ptrn) === 0)
    ) {
      this.redex.push(a_numb ? addr_of(b_ptrn) : addr_of(a_ptrn));
    }
  }

  // Disconnects a port, causing both sides to point to themselves
  unlink_port(a_ptrn: Port) {
    if (type_of(a_ptrn) === PortType.PTR) {
      var b_ptrn = this.enter_port(a_ptrn);
      if (
        type_of(b_ptrn) === PortType.PTR &&
        ptrn_eq(this.enter_port(b_ptrn), a_ptrn)
      ) {
        this.set_port(addr_of(a_ptrn), slot_of(a_ptrn), a_ptrn);
        this.set_port(addr_of(b_ptrn), slot_of(b_ptrn), b_ptrn);
      }
    }
  }

  // rwts an active pair
  rewrite(a_addr) {
    var a_ptrn = Pointer(a_addr, 0);
    var b_ptrn = this.get_port(a_addr, 0);
    if (type_of(b_ptrn) === PortType.NUM) {
      var a_type = this.type_of(a_addr);
      var a_kind = this.kind_of(a_addr);

      // UnaryOperation
      if (a_type === NodeType.OP1) {
        var dst = this.enter_port(Pointer(a_addr, 2));
        var fst = numb_of(b_ptrn);
        var snd = numb_of(this.enter_port(Pointer(a_addr, 1)));
        switch (a_kind) {
          case 0:
            var res = Numeric(fst + snd);
            break;
          case 1:
            var res = Numeric(fst - snd);
            break;
          case 2:
            var res = Numeric(fst * snd);
            break;
          case 3:
            var res = Numeric(fst / snd);
            break;
          case 4:
            var res = Numeric(fst % snd);
            break;
          case 5:
            var res = Numeric(fst ** snd);
            break;
          case 6:
            var res = Numeric(fst & snd);
            break;
          case 7:
            var res = Numeric(fst | snd);
            break;
          case 8:
            var res = Numeric(fst ^ snd);
            break;
          case 9:
            var res = Numeric(~snd);
            break;
          case 10:
            var res = Numeric(fst >>> snd);
            break;
          case 11:
            var res = Numeric(fst << snd);
            break;
          case 12:
            var res = Numeric(fst > snd ? 1 : 0);
            break;
          case 13:
            var res = Numeric(fst < snd ? 1 : 0);
            break;
          case 14:
            var res = Numeric(fst === snd ? 1 : 0);
            break;
          case 15:
            var res = Numeric(Math.sin(snd));
            break;
          case 16:
            var res = Numeric(Math.cos(snd));
            break;
          case 17:
            var res = Numeric(Math.tan(snd));
            break;
          case 18:
            var res = Numeric(Math.asin(snd));
            break;
          case 19:
            var res = Numeric(Math.acos(snd));
            break;
          case 20:
            var res = Numeric(Math.atan2(fst, snd));
            break;
          default:
            throw "[ERROR]\nInvalid interaction.";
        }
        this.link_ports(dst, res);
        this.unlink_port(Pointer(a_addr, 0));
        this.unlink_port(Pointer(a_addr, 2));
        this.free_node(a_addr);

        // BinaryOperation
      } else if (a_type === NodeType.OP2) {
        this.set_type(a_addr, NodeType.OP1);
        this.link_ports(
          Pointer(a_addr, 0),
          this.enter_port(Pointer(a_addr, 1))
        );
        this.unlink_port(Pointer(a_addr, 1));
        this.link_ports(Pointer(a_addr, 1), b_ptrn);

        // NumberDuplication
      } else if (a_type === NodeType.NOD) {
        this.link_ports(b_ptrn, this.enter_port(Pointer(a_addr, 1)));
        this.link_ports(b_ptrn, this.enter_port(Pointer(a_addr, 2)));
        this.free_node(a_addr);

        // IfThenElse
      } else if (a_type === NodeType.ITE) {
        var cond_val = numb_of(b_ptrn) === 0;
        var pair_ptr = this.enter_port(Pointer(a_addr, 1));
        this.set_type(a_addr, NodeType.NOD);
        this.link_ports(Pointer(a_addr, 0), pair_ptr);
        this.unlink_port(Pointer(a_addr, 1));
        var dest_ptr = this.enter_port(Pointer(a_addr, 2));
        this.link_ports(Pointer(a_addr, cond_val ? 2 : 1), dest_ptr);
        if (!cond_val) this.unlink_port(Pointer(a_addr, 2));
        this.link_ports(
          Pointer(a_addr, cond_val ? 1 : 2),
          Pointer(a_addr, cond_val ? 1 : 2)
        );
      } else {
        throw "[ERROR]\nInvalid interaction.";
      }
    } else {
      var b_addr = addr_of(b_ptrn);
      var a_type = this.type_of(a_addr);
      var b_type = this.type_of(b_addr);
      var a_kind = this.kind_of(a_addr);
      var b_kind = this.kind_of(b_addr);

      // NodeAnnihilation, UnaryAnnihilation, BinaryAnnihilation
      if (
        (a_type === NodeType.NOD &&
          b_type === NodeType.NOD &&
          a_kind === b_kind) ||
        (a_type === NodeType.OP1 && b_type === NodeType.OP1) ||
        (a_type === NodeType.OP2 && b_type === NodeType.OP2) ||
        (a_type === NodeType.ITE && b_type === NodeType.ITE)
      ) {
        var a_aux1_dest = this.enter_port(Pointer(a_addr, 1));
        var b_aux1_dest = this.enter_port(Pointer(b_addr, 1));
        this.link_ports(a_aux1_dest, b_aux1_dest);
        var a_aux2_dest = this.enter_port(Pointer(a_addr, 2));
        var b_aux2_dest = this.enter_port(Pointer(b_addr, 2));
        this.link_ports(a_aux2_dest, b_aux2_dest);
        for (var i = 0; i < 3; i++) {
          this.unlink_port(Pointer(a_addr, i));
          this.unlink_port(Pointer(b_addr, i));
        }
        this.free_node(a_addr);
        if (a_addr !== b_addr) {
          this.free_node(b_addr);
        }

        // NodeDuplication, BinaryDuplication
      } else if (
        (a_type === NodeType.NOD &&
          b_type === NodeType.NOD &&
          a_kind !== b_kind) ||
        (a_type === NodeType.NOD && b_type === NodeType.OP2) ||
        (a_type === NodeType.NOD && b_type === NodeType.ITE)
      ) {
        var p_addr = this.alloc_node(b_type, b_kind);
        var q_addr = this.alloc_node(b_type, b_kind);
        var r_addr = this.alloc_node(a_type, a_kind);
        var s_addr = this.alloc_node(a_type, a_kind);
        this.link_ports(Pointer(r_addr, 1), Pointer(p_addr, 1));
        this.link_ports(Pointer(s_addr, 1), Pointer(p_addr, 2));
        this.link_ports(Pointer(r_addr, 2), Pointer(q_addr, 1));
        this.link_ports(Pointer(s_addr, 2), Pointer(q_addr, 2));
        this.link_ports(
          Pointer(p_addr, 0),
          this.enter_port(Pointer(a_addr, 1))
        );
        this.link_ports(
          Pointer(q_addr, 0),
          this.enter_port(Pointer(a_addr, 2))
        );
        this.link_ports(
          Pointer(r_addr, 0),
          this.enter_port(Pointer(b_addr, 1))
        );
        this.link_ports(
          Pointer(s_addr, 0),
          this.enter_port(Pointer(b_addr, 2))
        );
        for (var i = 0; i < 3; i++) {
          this.unlink_port(Pointer(a_addr, i));
          this.unlink_port(Pointer(b_addr, i));
        }
        this.free_node(a_addr);
        if (a_addr !== b_addr) {
          this.free_node(b_addr);
        }

        // UnaryDuplication
      } else if (
        (a_type === NodeType.NOD && b_type === NodeType.OP1) ||
        (a_type === NodeType.ITE && b_type === NodeType.OP1)
      ) {
        var p_addr = this.alloc_node(b_type, b_kind);
        var q_addr = this.alloc_node(b_type, b_kind);
        var s_addr = this.alloc_node(a_type, a_kind);
        this.link_ports(
          Pointer(p_addr, 1),
          this.enter_port(Pointer(b_addr, 1))
        );
        this.link_ports(
          Pointer(q_addr, 1),
          this.enter_port(Pointer(b_addr, 1))
        );
        this.link_ports(Pointer(s_addr, 1), Pointer(p_addr, 2));
        this.link_ports(Pointer(s_addr, 2), Pointer(q_addr, 2));
        this.link_ports(
          Pointer(p_addr, 0),
          this.enter_port(Pointer(a_addr, 1))
        );
        this.link_ports(
          Pointer(q_addr, 0),
          this.enter_port(Pointer(a_addr, 2))
        );
        this.link_ports(
          Pointer(s_addr, 0),
          this.enter_port(Pointer(b_addr, 2))
        );
        for (var i = 0; i < 3; i++) {
          this.unlink_port(Pointer(a_addr, i));
          this.unlink_port(Pointer(b_addr, i));
        }
        this.free_node(a_addr);
        if (a_addr !== b_addr) {
          this.free_node(b_addr);
        }

        // Permutations
      } else if (a_type === NodeType.OP1 && b_type === NodeType.NOD) {
        return this.rewrite(b_addr);
      } else if (a_type === NodeType.OP2 && b_type === NodeType.NOD) {
        return this.rewrite(b_addr);
      } else if (a_type === NodeType.ITE && b_type === NodeType.NOD) {
        return this.rewrite(b_addr);

        // InvalidInteraction
      } else {
        throw "[ERROR]\nInvalid interaction.";
      }
    }
  }

  // rwts active pairs until none is left, reducing the graph to normal form.
  // This could be performed in parallel and doesn't need GC.
  reduce_strict(stats: Stats) {
    var rwts = 0;
    var loop = 0;
    var mlen = 0;
    while (this.redex.length > 0) {
      for (var i = 0, l = this.redex.length; i < l; ++i) {
        this.rewrite(this.redex.pop());
        stats.mlen = Math.max(stats.mlen, this.nodes.length / 4);
        ++stats.rwts;
      }
      ++stats.loop;
    }
  }

  // rwts active pairs until none is left, reducing the graph to normal form.
  // This avoids unecessary computations, but is sequential and would need GC.
  reduce_lazy(stats: Stats) {
    this.find_redex = false;
    var warp = [];
    var back = [];
    var prev = Pointer(0, 1);
    var next = this.enter_port(prev);
    var rwts = 0;
    while (true) {
      ++stats.loop;
      if (
        type_of(next) === PortType.PTR &&
        (addr_of(next) === 0 || this.is_free(addr_of(next)))
      ) {
        if (warp.length === 0) {
          break;
        } else {
          prev = warp.pop();
          next = this.enter_port(prev);
        }
      } else {
        if (
          slot_of(prev) === 0 &&
          (type_of(next) === PortType.NUM || slot_of(next) === 0)
        ) {
          try {
            this.rewrite(addr_of(prev));
          } catch (e) {
            return;
          }
          stats.rwts += 1;
          stats.mlen = Math.max(stats.mlen, this.nodes.length / 4);
          do {
            prev = back.pop();
          } while (type_of(prev) !== PortType.PTR);
          next = this.enter_port(prev);
          ++rwts;
        } else if (type_of(next) === PortType.NUM) {
          [prev, next] = [next, prev];
        } else if (slot_of(next) === 0) {
          if (this.type_of(addr_of(next)) !== NodeType.OP1) {
            warp.push(Pointer(addr_of(next), 1));
          }
          prev = Pointer(addr_of(next), 2);
          next = this.enter_port(prev);
        } else {
          back.push(prev);
          prev = Pointer(addr_of(next), 0);
          next = this.enter_port(prev);
        }
      }
    }
    this.find_redex = true;
  }

  // Returns a string that is preserved on reduction, good for debugging
  denote(ptrn = this.enter_port(Pointer(0, 1)), exit = []) {
    function path_to_string(path) {
      var str = "<";
      while (path) {
        str += path.head === 1 ? "a" : "b";
        path = path.tail;
      }
      str += ">";
      return str;
    }
    while (true) {
      if (type_of(ptrn) === PortType.PTR) {
        var ai = addr_of(ptrn);
        var as = slot_of(ptrn);
        var ak = this.kind_of(ai);
        switch (this.type_of(ai)) {
          case NodeType.NOD:
            if (slot_of(ptrn) === 0) {
              if (exit[ak]) {
                var new_exit = exit.slice(0);
                new_exit[ak] = new_exit[ak].tail;
                ptrn = this.enter_port(Pointer(ai, Number(exit[ak].head)));
                exit = new_exit;
                continue; // tail-call: denote(ptrn, exit)
              } else {
                var lft = this.denote(this.enter_port(Pointer(ai, 1)), exit);
                var rgt = this.denote(this.enter_port(Pointer(ai, 2)), exit);
                return "(" + ak + " " + lft + " " + rgt + ")";
              }
            } else {
              if (ai === 0) {
                while (exit[exit.length - 1] === null) exit.pop();
                return exit.map(path_to_string).join(":");
              } else {
                var new_exit = exit.slice(0);
                new_exit[ak] = { head: as, tail: new_exit[ak] || null };
                ptrn = this.enter_port(Pointer(ai, 0));
                exit = new_exit;
                continue; // tail-call: denote(ptrn, exit)
              }
            }
            break;
          default:
            return "<TODO>";
        }
      } else {
        return "#" + numb_of(ptrn);
      }
    }
  }

  to_string() {
    const pointer = ptrn => {
      if (type_of(ptrn) === PortType.NUM) {
        return "#" + numb_of(ptrn);
      } else {
        return addr_of(ptrn) + "abc"[slot_of(ptrn)];
      }
    };
    var text = "";
    for (var i = 0; i < this.nodes.length / 4; i++) {
      if (this.is_free(i)) {
        text += i + ": ~\n";
      } else {
        var type = this.type_of(i);
        var kind = this.kind_of(i);
        text += i + ": ";
        text += "[" + type + ":" + kind + "| ";
        text += pointer(this.get_port(i, 0)) + " ";
        text += pointer(this.get_port(i, 1)) + " ";
        text += pointer(this.get_port(i, 2)) + "]";
        text +=
          " ... " +
          this.is_numeric(i, 0) +
          " " +
          this.is_numeric(i, 1) +
          " " +
          this.is_numeric(i, 2);
        text += "\n";
      }
    }
    return text;
  }
}

export {
  Stats,
  init_stats,
  Port,
  PortType,
  NodeType,
  Pointer,
  addr_of,
  slot_of,
  Numeric,
  numb_of,
  type_of,
  ptrn_eq,
  ptrn_st,
  Net
};
