"""Exercise the real payload converter without booting the app or its database."""
import ast
import copy
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'open_webui/routers/openai.py'
tree = ast.parse(SOURCE.read_text())
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'convert_to_responses_payload')
scope = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), 'exec'), scope)
convert = scope['convert_to_responses_payload']


class ResponsesReasoningTests(unittest.TestCase):
    def payload(self, **params):
        return {'model': 'gpt-5.6-sol', 'stream': True,
                'messages': [{'role': 'user', 'content': '1'}], **params}

    def test_ui_selected_effort_uses_native_field(self):
        for model in ('gpt-5.6-sol', 'gpt-6-sol'):
            for effort in ('none', 'low', 'medium', 'high', 'xhigh', 'max'):
                out = convert(self.payload(model=model, reasoning_effort=effort))
                self.assertNotIn('reasoning_effort', out)
                self.assertEqual(out['reasoning'], {'effort': effort})
                self.assertEqual(out['model'], model)
                self.assertEqual(out['input'], [{'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': '1'}]}])

    def test_native_reasoning_wins_without_mutating_input_object(self):
        reasoning = {'effort': 'high', 'summary': 'auto', 'mode': 'pro'}
        before = copy.deepcopy(reasoning)
        out = convert(self.payload(reasoning_effort='medium', reasoning=reasoning))
        self.assertEqual(out['reasoning'], before)
        self.assertEqual(reasoning, before)
        self.assertNotIn('reasoning_effort', out)
        self.assertEqual(convert(self.payload(reasoning={'summary': 'auto'}, reasoning_effort='low'))['reasoning'], {'summary': 'auto', 'effort': 'low'})

    def test_missing_effort_does_not_invent_a_default(self):
        for params in ({}, {'reasoning_effort': None}):
            out = convert(self.payload(**params))
            self.assertNotIn('reasoning', out)
            self.assertNotIn('reasoning_effort', out)
        self.assertEqual(convert(self.payload(reasoning={'effort': 'max'}))['reasoning'], {'effort': 'max'})

    def test_tools_history_cache_and_limit_conversion_are_preserved(self):
        out = convert(self.payload(reasoning_effort='medium', prompt_cache_key='client-key', max_tokens=100,
            tools=[{'type': 'function', 'function': {'name': 'lookup', 'parameters': {'type': 'object'}}}],
            messages=[{'role': 'system', 'content': 'policy'},
                      {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'call1', 'function': {'name': 'lookup', 'arguments': '{}'}}]},
                      {'role': 'tool', 'tool_call_id': 'call1', 'content': 'result'},
                      {'role': 'user', 'content': 'continue'}]))
        self.assertEqual(out['instructions'], 'policy')
        self.assertEqual(out['prompt_cache_key'], 'client-key')
        self.assertEqual(out['max_output_tokens'], 100)
        self.assertEqual(out['tools'][0]['name'], 'lookup')
        self.assertEqual([i['type'] for i in out['input']], ['function_call', 'function_call_output', 'message'])
        self.assertEqual(out['reasoning'], {'effort': 'medium'})


if __name__ == '__main__':
    unittest.main()
