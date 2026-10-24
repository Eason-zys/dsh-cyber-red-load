window.__ModuleLoader__.load({
	id: "dsh-cyber-red-load",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		//#region lib/client.js
		/**
		 * 算力负载（reasoning effort）常驻滑动条。
		 *
		 * 背景：DSH 原生的推理等级入口藏在模型弹层的第二行（「推理等级 Low ›」），
		 * 每次改档都要先点开模型弹层。这个插件把它搬到输入框底部工具行
		 * （`conversation.input.left` 插槽）常驻成一条四档滑动条，档位改名
		 * 空载 / 轻载 / 重载 / 超频，同时：
		 *   - 隐藏原生弹层里单独那一行「推理等级」；
		 *   - 把模型按钮上残留的英文档位名（Low / High …）就地换成中文档位名。
		 *
		 * 状态来源与写入方式与官方 model-selection 插件完全一致：
		 * `ctx.modelDirectories.directoryFor(sessionId)` 暴露会话级目录
		 * （store 快照 + select 动词），写档位走 `directory.select({
		 * provider, model, reasoningEffort })`，最终落到
		 * `sessions.selectModel` RPC。因此不重复实现竞态保护、失败态和
		 * subagent 会话的可用性判断。
		 */
		var React = require("react");

		var PLUGIN = "dsh-cyber-red-load";
		var SLOT = "conversation.input.left";
		var STYLE_TAG_ID = PLUGIN + "/load-bar.css";

		/** 原生四档 id（见 dsh-llm-deepseek：off / low / high / max）→ 新名字。 */
		var EFFORT_LABELS = {
			"off": "空载",
			"low": "轻载",
			"high": "重载",
			"max": "超频"
		};
		/** 顺序兜底：provider 用了别的 id 时按位次给名字。 */
		var EFFORT_FALLBACK = ["空载", "轻载", "重载", "超频"];

		/** 原生弹层里要隐藏的那一行，按其可见文案识别（中英双语）。 */
		var NATIVE_EFFORT_TEXT = /推理等级|reasoning\s*effort/i;
		/** 原生按钮上残留的英文档位名。 */
		var NATIVE_EFFORT_WORD = /\b(off|low|high|max)\b/gi;

		/** 每档占几格；四档 × 3 格 = 12 格的分段条，和参考图的比例接近。 */
		var CELLS_PER_LEVEL = 3;

		var CSS = [
			".crl-bar{display:flex;align-items:center;gap:7px;min-width:0;height:24px;padding:0 2px;",
			"font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Cascadia Mono','Microsoft YaHei Mono',monospace;",
			"font-size:11px;line-height:1;letter-spacing:.08em;color:var(--dsw-alias-label-secondary,#c99aa2);",
			"-webkit-user-select:none;user-select:none;}",
			".crl-bar[data-pending='true'] .crl-marker{animation:crl-settle 520ms ease-out;}",
			"@keyframes crl-settle{0%{box-shadow:0 0 9px 1px rgba(255,120,120,.95),0 0 2px rgba(255,255,255,.95);}100%{box-shadow:0 0 4px 0 rgba(255,80,80,.35),0 0 1px rgba(255,255,255,.6);}}",
			".crl-label{opacity:.62;white-space:nowrap;letter-spacing:.14em;",
			"text-shadow:0 0 6px rgba(255,60,60,.28);}",
			".crl-slider{position:relative;display:flex;align-items:center;width:150px;height:24px;",
			"cursor:pointer;touch-action:none;outline:none;}",
			".crl-slider[data-pending='true']{cursor:default;}",
			".crl-slider:focus-visible .crl-cells{box-shadow:0 0 0 1px rgba(255,88,88,.55);border-radius:2px;}",
			".crl-cells{display:flex;align-items:center;gap:2px;width:100%;height:11px;}",
			".crl-cell{flex:1 1 0;height:100%;border-radius:1px;",
			"border:1px solid rgba(160,26,26,.38);background-color:rgba(104,14,14,.42);",
			"background-image:repeating-linear-gradient(118deg,rgba(255,120,120,.16) 0 1px,transparent 1px 3px);",
			"transition:background-color .09s linear,box-shadow .09s linear,border-color .09s linear;}",
			".crl-cell[data-on='true']{background-color:#df2222;border-color:rgba(255,130,130,.9);",
			"background-image:repeating-linear-gradient(118deg,rgba(255,238,238,.6) 0 1px,rgba(255,150,150,.14) 1px 3px);",
			"box-shadow:0 0 7px rgba(255,46,46,.55),inset 0 0 4px rgba(255,205,205,.32);}",
			".crl-marker{position:absolute;top:2px;bottom:2px;width:2px;margin-left:-1px;background:#fff;",
			"transform:skewX(-14deg);pointer-events:none;transition:left .08s linear;",
			"box-shadow:0 0 9px 1px rgba(255,80,80,.9),0 0 2px rgba(255,255,255,.95);}",
			".crl-slider[data-dragging='true'] .crl-marker{transition:none;}",
			".crl-value{min-width:30px;white-space:nowrap;color:var(--dsw-alias-label-primary,#fff4f6);",
			"letter-spacing:.12em;text-shadow:0 0 8px rgba(255,88,88,.55);}",
			"@media (max-width:760px){.crl-label{display:none;}.crl-slider{width:118px;}}",
			"@media (max-width:560px){.crl-bar{gap:6px;}.crl-slider{width:96px;}}"
		].join("");

		/** 样式只注册一次；重复 apply（HMR 重新组合）不会叠 <style>。 */
		function installStyle() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_TAG_ID) + "]") !== null) return;
			var tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN;
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/**
		 * 隐藏原生模型弹层里的「推理等级」行：它是 `[role="menu"]` 里的
		 * `button[role="menuitem"]`，文案由 DSH 字典决定，因此按文案匹配而不是
		 * 按 CSS module 的哈希类名匹配（后者随版本变化）。
		 * @param root - 搜索起点（document.body）。
		 */
		function hideNativeEffort(root) {
			if (!root || typeof root.querySelectorAll !== "function") return;
			var menus = root.querySelectorAll('[role="menu"]');
			for (var i = 0; i < menus.length; i += 1) {
				var cells = menus[i].children;
				for (var j = 0; j < cells.length; j += 1) {
					var cell = cells[j];
					if (cell.tagName !== "BUTTON" || cell.dataset.crlHidden === "1") continue;
					if (NATIVE_EFFORT_TEXT.test(cell.textContent || "")) {
						cell.style.display = "none";
						cell.dataset.crlHidden = "1";
					}
				}
			}
		}

		/** 把一段文本里的英文档位名换成中文档位名（其余内容原样保留）。 */
		function localizeEffortWords(text) {
			return String(text).replace(NATIVE_EFFORT_WORD, function (word) {
				return EFFORT_LABELS[word.toLowerCase()] || word;
			});
		}

		/** 深度遍历一棵子树里的文本节点。 */
		function walkTextNodes(element, visit) {
			var node = element.firstChild;
			while (node !== null) {
				var next = node.nextSibling;
				if (node.nodeType === 3) visit(node);
				else if (node.nodeType === 1) walkTextNodes(node, visit);
				node = next;
			}
		}

		/**
		 * 模型按钮（输入框右下那颗 trigger）仍会显示原生档位名，
		 * 例如「DeepSeek-V4.1-Flash 1017 Low」。React 每次重渲染都会把
		 * 文本写回，所以这里就地改写文本节点，并由 MutationObserver 兜底重跑。
		 * @param root - 搜索起点。
		 */
		function localizeNativeTrigger(root) {
			if (!root || typeof root.querySelectorAll !== "function") return;
			var holders = root.querySelectorAll('[data-slot^="conversation.input"]');
			for (var i = 0; i < holders.length; i += 1) {
				walkTextNodes(holders[i], function (node) {
					var text = node.nodeValue;
					/* 只认「整段就是档位名」的文本节点，避免误伤模型名里的同名单词 */
					if (text && /^\s*(off|low|high|max)\s*$/i.test(text)) node.nodeValue = localizeEffortWords(text.trim());
				});
			}
		}

		/**
		 * 监听 DOM：弹层每次展开都是一次新挂载，模型按钮文本也会随选择变化，
		 * 所以持续观察而不是只跑一次。
		 * @returns 清理函数。
		 */
/* 拖动时暂停扫描：扫描是整棵子树遍历，和指针帧抢主线程就会觉得卡。 */
		var nativeScanPaused = false;
		var nativePauseTimer = 0;
		var nativeScanRequest = function () {};

		/** 拖动时暂停扫描；恢复时补扫一次，并带 1.5s 兜底防止异常路径永久停摆。 */
		function setNativeScanPaused(paused) {
			nativeScanPaused = paused;
			if (nativePauseTimer !== 0) {
				clearTimeout(nativePauseTimer);
				nativePauseTimer = 0;
			}
			if (paused) {
				nativePauseTimer = setTimeout(function () {
					nativePauseTimer = 0;
					nativeScanPaused = false;
					nativeScanRequest();
				}, 1500);
				return;
			}
			nativeScanRequest();
		}

		function watchNativeDom() {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return function () {};
			var scheduled = false;
			var scan = function () {
				scheduled = false;
				if (nativeScanPaused) return;
				try {
					hideNativeEffort(document.body);
					localizeNativeTrigger(document.body);
				} catch (error) {
					/* 观察器不能因一次异常停摆 */
				}
			};
			/* 聊天流式输出会不停触发 mutation；这里合并成 150ms 一次，
		   避免每个渲染帧都全量 querySelectorAll 拖慢拖拽手感。 */
			var schedule = function () {
				if (scheduled) return;
				scheduled = true;
				setTimeout(scan, 150);
			};
			scan();
			nativeScanRequest = schedule;
			var observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			return function () {
				observer.disconnect();
				nativeScanRequest = function () {};
				if (nativePauseTimer !== 0) {
					clearTimeout(nativePauseTimer);
					nativePauseTimer = 0;
				}
				nativeScanPaused = false;
			};
		}

		/** 在目录快照里找到当前 provider/model 对应的模型条目。 */
		function findModel(groups, current) {
			if (!current || !Array.isArray(groups)) return void 0;
			for (var i = 0; i < groups.length; i += 1) {
				var group = groups[i];
				if (!group || group.id !== current.provider) continue;
				var models = Array.isArray(group.models) ? group.models : [];
				for (var j = 0; j < models.length; j += 1) {
					if (models[j] && models[j].id === current.model) return models[j];
				}
			}
			return void 0;
		}

		/** 取当前档位：会话显式选择优先，其次模型默认档。 */
		function effectiveEffort(current, reasoning) {
			if (current && typeof current.reasoningEffort === "string" && current.reasoningEffort.length > 0) return current.reasoningEffort;
			if (reasoning && typeof reasoning.defaultEffort === "string" && reasoning.defaultEffort.length > 0) return reasoning.defaultEffort;
			return reasoning && Array.isArray(reasoning.efforts) && reasoning.efforts.length > 0 ? reasoning.efforts[0].id : void 0;
		}

		function effortIndex(efforts, id) {
			for (var i = 0; i < efforts.length; i += 1) {
				if (efforts[i].id === id) return i;
			}
			return -1;
		}

		function labelOf(level, index) {
			if (!level) return "";
			return EFFORT_LABELS[level.id] || EFFORT_FALLBACK[index] || level.name || level.id;
		}

		/** 悬停提示：四档名称串成一行。 */
		function effortTitle(efforts, lastIndex) {
			var names = [];
			for (var i = 0; i <= lastIndex; i += 1) names.push(labelOf(efforts[i], i));
			return names.join(" / ");
		}

		/** 拖动时把指针位置折算成 0..1 的比例（两端留出标记半径）。 */
		function ratioFromPointer(element, clientX) {
			if (!element || typeof element.getBoundingClientRect !== "function") return 0;
			var rect = element.getBoundingClientRect();
			var pad = 7;
			var left = rect.left + pad;
			var span = Math.max(1, rect.right - pad - left);
			var ratio = (clientX - left) / span;
			if (!isFinite(ratio)) return 0;
			return Math.min(1, Math.max(0, ratio));
		}

		function LoadBar(props) {
			var directory = props.directory;
			var snapshot = React.useSyncExternalStore(
				function (onStoreChange) {
					return directory.subscribe(onStoreChange);
				},
				function () {
					return directory.getSnapshot();
				}
			);
			var sliderRef = React.useRef(null);
			/* 拖动中的临时比例：松手才提交，避免每一步都打一次 selectModel。 */
			var dragState = React.useState(null);
			var drag = dragState[0];
			var setDrag = dragState[1];

			var current = snapshot ? snapshot.current : null;
			var model = findModel(snapshot ? snapshot.groups : [], current);
			var reasoning = model ? model.reasoning : void 0;
			var efforts = reasoning && Array.isArray(reasoning.efforts) ? reasoning.efforts : null;
			var ready = props.available === true && current !== null && efforts !== null && efforts.length > 0;
			var active = ready ? effectiveEffort(current, reasoning) : void 0;
			var activeIndex = ready ? effortIndex(efforts, active) : -1;
			if (ready && activeIndex < 0) activeIndex = 0;
			var lastIndex = ready ? efforts.length - 1 : 0;
			var pending = snapshot !== null && snapshot.status === "selecting";
			/* 松手后宿主往返有几百毫秒，这段时间先按本地目标档渲染，
			   否则竖标会先弹回旧档位、再跳到新档位，看起来像卡一下。 */
			var optimisticState = React.useState(null);
			var optimistic = optimisticState[0];
			var setOptimistic = optimisticState[1];
			React.useEffect(
				function () {
					if (optimistic === null) return void 0;
					if (active === optimistic.effort) {
						setOptimistic(null);
						return void 0;
					}
					if (snapshot !== null && snapshot.error) {
						/* 选择失败：回落到宿主回报的真实档位 */
						setOptimistic(null);
						return void 0;
					}
					var timer = setTimeout(function () {
						setOptimistic(null);
					}, 2500);
					return function () {
						clearTimeout(timer);
					};
				},
				[optimistic, active, snapshot]
			);

/* 宿主确认新档位后会立刻把 trigger 文本写回英文，这里在绘制前就改回中文。 */
			var useLayoutEffect = typeof React.useLayoutEffect === "function" ? React.useLayoutEffect : React.useEffect;
			useLayoutEffect(function () {
				if (typeof document === "undefined" || !document.body) return void 0;
				try {
					localizeNativeTrigger(document.body);
				} catch (error) {
					/* 页面结构异常时交给 MutationObserver 兜底 */
				}
				return void 0;
			}, [active]);

			/* 拖动期间暂停原生 DOM 扫描，避免整棵子树遍历和指针帧抢主线程。 */
			React.useEffect(
				function () {
					setNativeScanPaused(drag !== null);
					return function () {
						setNativeScanPaused(false);
					};
				},
				[drag]
			);

			var pointerId = React.useRef(null);

			var commit = function (index) {
				if (!ready || pending) return;
				var level = efforts[index];
				if (!level || level.id === active) return;
				setOptimistic({ effort: level.id, index: index });
				var selection = {
					provider: current.provider,
					model: current.model,
					reasoningEffort: level.id
				};
				var fire = function () {
					try {
						var outcome = props.select(selection);
						if (outcome && typeof outcome.catch === "function") outcome.catch(function () {});
					} catch (error) {
						/* select 的错误已经由目录 store 呈现（pending/error 字段） */
						setOptimistic(null);
					}
				};
				/* 让这一帧先把竖标画到松手位置，跨进程调用放下一帧 */
				if (typeof requestAnimationFrame === "function") requestAnimationFrame(fire);
				else fire();
			};

			/* 非推理模型、subagent 会话、目录未就绪（current 为空）都不显示。 */
			if (!ready) return null;

			var displayIndex = activeIndex;
			if (optimistic !== null) {
				var optimisticIndex = effortIndex(efforts, optimistic.effort);
				if (optimisticIndex >= 0) displayIndex = optimisticIndex;
			}
			var ratio = lastIndex === 0 ? 0 : displayIndex / lastIndex;
			if (drag !== null) ratio = drag.ratio;
			var previewIndex = Math.round(ratio * lastIndex);
			var previewLabel = labelOf(efforts[previewIndex], previewIndex);

			var onPointerDown = function (event) {
				if (pending || event.button !== 0) return;
				pointerId.current = event.pointerId;
				var sliderEl = sliderRef.current;
				var ratioNow = ratioFromPointer(sliderEl, event.clientX);
				setDrag({ pointerId: event.pointerId, ratio: ratioNow });
				if (sliderEl !== null && typeof sliderEl.setPointerCapture === "function") {
					try {
						sliderEl.setPointerCapture(event.pointerId);
					} catch (error) {
						/* 老浏览器不支持指针捕获时退化为普通拖动 */
					}
				}
				event.preventDefault();
			};
			var moveFrame = React.useRef(0);
			var lastClientX = React.useRef(0);
			var onPointerMove = function (event) {
				if (drag === null || drag.pointerId !== event.pointerId) return;
				lastClientX.current = event.clientX;
				if (moveFrame.current !== 0) return;
				var pointer = event.pointerId;
				/* 每帧最多一次 setState，拖拽跟手且不丢帧 */
				moveFrame.current = requestAnimationFrame(function () {
					moveFrame.current = 0;
					setDrag({ pointerId: pointer, ratio: ratioFromPointer(sliderRef.current, lastClientX.current) });
				});
			};
			var finishDrag = function (event) {
				if (drag === null || drag.pointerId !== event.pointerId) return;
				var finalRatio = drag.ratio;
				setDrag(null);
				var sliderEl = sliderRef.current;
				if (sliderEl !== null && typeof sliderEl.releasePointerCapture === "function" && pointerId.current !== null) {
					try {
						sliderEl.releasePointerCapture(pointerId.current);
					} catch (error) {
						/* 指针可能已被系统释放 */
					}
				}
				pointerId.current = null;
				commit(Math.round(finalRatio * lastIndex));
				if (event && typeof event.preventDefault === "function") event.preventDefault();
			};
			var onPointerCancel = function () {
				setDrag(null);
				pointerId.current = null;
			};
			var onKeyDown = function (event) {
				if (pending) return;
				var next = null;
				if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(lastIndex, previewIndex + 1);
				else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, previewIndex - 1);
				else if (event.key === "Home") next = 0;
				else if (event.key === "End") next = lastIndex;
				if (next === null) return;
				event.preventDefault();
				commit(next);
			};

			var cellCount = Math.max(efforts.length, efforts.length * CELLS_PER_LEVEL);
			var litCells = Math.round(ratio * cellCount);
			var cells = [];
			for (var cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
				cells.push(React.createElement("span", {
					key: "cell-" + cellIndex,
					"className": "crl-cell",
					"data-on": cellIndex < litCells ? "true" : "false",
					"aria-hidden": "true"
				}));
			}

			return React.createElement(
				"div",
				{
					"className": "crl-bar",
					"data-pending": pending ? "true" : "false",
					"role": "group",
					"aria-label": "算力负载"
				},
				React.createElement("span", { "className": "crl-label" }, "算力负载"),
				React.createElement(
					"div",
					{
						"ref": sliderRef,
						"className": "crl-slider",
						"data-pending": pending ? "true" : "false",
						"data-dragging": drag !== null ? "true" : "false",
						"role": "slider",
						"tabIndex": pending ? -1 : 0,
						"aria-label": "算力负载",
						"aria-valuemin": 0,
						"aria-valuemax": lastIndex,
						"aria-valuenow": previewIndex,
						"aria-valuetext": previewLabel,
						"aria-disabled": pending ? "true" : "false",
						"onPointerDown": onPointerDown,
						"onPointerMove": onPointerMove,
						"onPointerUp": finishDrag,
						"onPointerCancel": onPointerCancel,
						"onLostPointerCapture": onPointerCancel,
						"onKeyDown": onKeyDown
					},
					React.createElement(
						"div",
						{ "className": "crl-cells", "title": effortTitle(efforts, lastIndex) },
						cells
					),
					React.createElement("div", {
						"className": "crl-marker",
						/* 首尾各内缩 4px，竖标不会顶到格子外面 */
						"style": { left: "calc(" + ratio * 100 + "% + " + ((0.5 - ratio) * 8).toFixed(2) + "px)" },
						"aria-hidden": "true"
					})
				),
				React.createElement("span", { "className": "crl-value" }, pending ? "…" : previewLabel)
			);
		}

		function apply(ctx) {
			installStyle();
			var loaded = new Set();
			/* 目录按 session 惰性加载；每个会话只触发一次，失败交给目录自身的错误态。 */
			ctx.slots.inject(SLOT, function () {
				return ctx.slots.register(
					{
						name: SLOT,
						id: "cyber-red-load",
						order: 5,
						inject: function (sessionId) {
							try {
								var models = ctx.get("modelDirectories");
								var sessions = ctx.get("sessions");
								if (models === void 0 || sessions === void 0) return { available: false };
								/* subagent 会话没有模型选择权，和官方入口保持一致。 */
								if (typeof sessions.subagentAddress === "function" && sessions.subagentAddress(sessionId) !== void 0) {
									return { available: false };
								}
								var directory = models.directoryFor(sessionId);
								if (!loaded.has(sessionId)) {
									loaded.add(sessionId);
									directory.load().then(function () {}, function () {});
								}
								return {
									available: true,
									directory: directory.store,
									select: function (selection) {
										return directory.select(selection);
									}
								};
							} catch (error) {
								return { available: false };
							}
						}
					},
					LoadBar
				);
			});
			ctx.effect(function () {
				return watchNativeDom();
			}, "cyber-red-load: hide native reasoning row and localize trigger");
		}
		//#endregion

		return {
			name: "cyber-red-load",
			/* modelDirectories 服务在首次 get 时会用调用方 ctx 实例化，故需声明其依赖链。 */
			inject: ["slots", "sessions", "remote", "remote.session"],
			apply: apply
		};
	}
});
